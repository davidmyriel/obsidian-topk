# Beta 0.1.0-beta.1: outside tester findings

Tested 2026-10-30 against `main` at `a964c13` (the code released as `0.1.0-beta.1`). Methods:
reading the code, Node-level probes of `src/indexer`, `src/render` and `src/topk`, the e2e harness
(real Obsidian 1.14 "latest", plus 1.11.4 "earliest" for the link specs) with the mock TopK, and
one live TopK probe in a throwaway collection (`holehunt-e164326c`, deleted, and a listing
confirmed no `holehunt-*` collection is left; spend under $0.01).

Known limitations from the brief (loose single-word matches, no image queries, desktop only, weak
non-Latin handwriting) are not reported.

## How to run the reproductions

Each committed test asserts the **expected** behaviour, so it fails while the bug exists.

```bash
npx vitest run --project qa
```

```bash
npm run build && OBSIDIAN_VERSIONS=latest npx wdio run ./wdio.conf.mts --spec tests/e2e/qa/links.qa.ts --spec tests/e2e/qa/stale-paths.qa.ts --spec tests/e2e/qa/maintenance-race.qa.ts
```

The e2e files end in `.qa.ts`, not `.e2e.ts`, so the normal `npm run test:e2e` suite does not pick
them up. The `qa` vitest project is separate from `npm test`, which still passes (128 tests).

## Findings, by severity

| #   | Severity | Finding                                                                     | Failing test |
| --- | -------- | --------------------------------------------------------------------------- | ------------ |
| F1  | blocker  | One misnamed image (PNG bytes in a `.jpg`) stops the whole vault indexing   | yes (Node)   |
| F10 | blocker  | "Remove my data from TopK" does not stick: the vault is re-uploaded         | yes (e2e)    |
| F9  | major    | Clear local index or Rebuild confirmed during a run silently empties search | yes (e2e)    |
| F8  | major    | Results use stale paths; clicking one creates an empty `talk.pdf.md` note   | yes (e2e)    |
| F7  | major    | File names with `#` or `\|`: opening a result creates a stray note          | yes (e2e)    |
| F2  | major    | Transparent PNGs are uploaded with alpha and become nearly unsearchable     | yes (Node)   |
| F4  | major    | A copied vault shares the vault id; each copy deletes the other's pages     | yes (Node)   |
| F5  | minor    | A corrupt `index-state.json` creates a new vault id; old pages orphaned     | yes (Node)   |
| F3  | minor    | Pages of a file that fails mid-render stay in TopK, untracked               | yes (Node)   |
| F6  | minor    | Tall images: progress shows done > total and the cost estimate undercounts  | yes (Node)   |
| F11 | minor    | Changing the collection leaves the old collection's pages behind            | no           |
| F12 | minor    | Queries over 4,096 characters show a raw TopK error                         | no (live)    |
| F13 | minor    | Search reopens with results from before "Remove my data"                    | no           |
| F14 | minor    | Identical files in two folders: only the alphabetically first is ever shown | no           |
| F15 | minor    | Empty files share one hash; an empty `.png` is reported as an empty PDF     | no (probe)   |
| F16 | minor    | A file deleted during a run is reported as a failure                        | no           |
| F17 | minor    | An `http://` custom endpoint sends the API key in cleartext without warning | no           |
| D1  | docs     | PRIVACY.md says pages are sent as JPEG; originals (with EXIF/GPS) are sent  | no           |
| D2  | docs     | Nothing says to run "Remove my data" before uninstalling or copying a vault | no           |
| D3  | docs     | Collection setting text promises a re-index that does not happen            | no           |

---

### F1 (blocker): one misnamed image blocks indexing of the whole vault, on every run

**Steps**

1. Put a PNG file in the vault with a `.jpg` extension (very common: browser "Save image as",
   some screenshot tools, files renamed by hand). It has to be at most 512 KB and 1.3 MP, which
   is typical for screenshots.
2. Run **Index vault**.

**Expected:** that file is marked failed (visible in Show index status) and everything else is
indexed.

**Actual:** TopK rejects the whole upsert request, so the run stops with "TopK rejected the request:
Invalid image: Format error decoding Jpeg …". Every file whose pages share that batch (up to 4 MB,
so for a small vault, all of them) is recorded `partial`. The next run, background or manual,
builds the same batch and fails the same way. The vault never finishes indexing, and with "Index
automatically" on, this repeats silently on every file change.

**Evidence**

- Live TopK, single-image upserts: `png-bytes-as-jpeg`, `jpeg-bytes-as-png` and `webp-bytes-as-png`
  are all `REJECTED: Invalid image: Format error decoding …`. A batch with one good and one bad
  image is rejected as a whole (`mixed-batch: REJECTED`). 1×1 and 10×14 px images are accepted.
- `tests/qa/beta-1-findings.test.ts` › F1, with a fake that rejects mismatched images as live TopK
  does: after two runs, `expected +0 to be 4`. None of the 4 fixture files were indexed. A second
  test shows `prepareImage('jpg', <PNG bytes>)` returns `format: 'jpeg'` with PNG bytes.

**Suspected code:** `src/render/pageSource.ts` `encodeImage()` picks the passthrough format from the
file extension, not from the bytes. `src/indexer/indexer.ts` `runIndex()` treats any upload error as
fatal for the run (`if (err === uploader.error) throw err`), and `src/indexer/uploader.ts` cannot
tell which page of a batch was bad. Sniffing magic bytes, and on an `invalid` error retrying the
batch's pages one at a time and marking the bad page's file `failed`, would fix both halves.

### F10 (blocker): "Remove my data from TopK" does not stick

**Steps (A: restart)**

1. Defaults: "Index automatically" on. Index the vault.
2. Run **Remove my data from TopK** and confirm. The notice says the pages were removed.
3. Restart Obsidian, or add, change or rename any PDF or image.

**Expected:** nothing is uploaded again until the user runs Index vault and confirms. The user just
asked for their data to be removed.

**Actual:** the startup reconcile (`scheduler.request()` in `onLayoutReady`) runs a background
index. `uploadConsent` is still true and every hash is gone from the state, so it silently
re-uploads the whole vault and charges for it again.

**Steps (B: during a run).** Open **Remove my data from TopK**. While the dialog is open, a
background run starts (5 s after any file change). Click **Remove**.

**Actual (B):** `deleteVault` runs, then the run keeps uploading, so the pages are in TopK again
afterwards. Search returns 10 results right after the removal.

**Evidence:** `tests/e2e/qa/maintenance-race.qa.ts`:

```
QA F10 during run: {"indexed":4,"rows":10,"status":""}        expected rows: []
QA F10 after restart: {"indexed":4}                            expected 0
```

**Suspected code:** `src/indexing.ts` `IndexMaintenance.removeData()` keeps `uploadConsent` and
leaves auto-indexing on. `busy()` is checked only **before** the confirm dialog, never after it.
Removal should reset consent (or pause auto-indexing) and re-check `indexer.running` (or cancel the
run) after confirmation.

### F9 (major): Clear local index or Rebuild confirmed during a run empties search silently

**Steps**

1. Open **Clear local index** (or **Rebuild index**). While the dialog is open, an index run starts
   (any background run, 5 s after a file change).
2. Click **Clear** while it is uploading.
3. Run **Index vault** again (or let the next background run happen).

**Expected:** search finds the vault's pages.

**Actual:** **Show index status** says every file is indexed, but search returns "No matching
pages." for everything. The in-flight run records its files as `indexed` in the hashes map that
Clear just replaced, while `needsPurge` stays set. The next run deletes the whole vault from TopK
and then skips every file as "unchanged". The only way out is another Rebuild. Rebuild has the same
problem: it resets the state, then calls `run()`, which says "Indexing is already running." and
returns while the old run keeps writing.

**Evidence:** `tests/e2e/qa/maintenance-race.qa.ts`:
`QA F9: {"indexed":4,"rows":0,"status":"No matching pages."}`.

**Suspected code:** `src/indexing.ts` `IndexMaintenance.rebuild()` and `clearLocal()` check `busy()`
only before `confirm()`, then mutate the cached `IndexState` object, which a running `runIndex()`
shares (`StateStore.load()` returns the same instance).

### F8 (major): results show stale paths, and clicking one creates an empty note

**Steps**

1. "Index automatically" off (or on, within the 5 s debounce, or after a failed run). Index the
   vault.
2. Rename or move `Talks/talk.pdf` to `Talks/renamed talk.pdf`.
3. Search for the hero query and click the first result.

**Expected:** the result shows and opens `Talks/renamed talk.pdf` at page 3. Renames are "free"
according to the README.

**Actual:** the result shows the old path `Talks/talk.pdf`. Its thumbnail is blank, because
`fillPreview` cannot find the file. Clicking it **creates and opens an empty note
`Talks/talk.pdf.md`**. Deleted files behave the same until the next run.

**Evidence:** `tests/e2e/qa/stale-paths.qa.ts`:

```
QA F8 rows: ["talk.pdf\nPage 3 · Talks/talk.pdf", ...]
QA F8 open: {"view":{"file":"Talks/talk.pdf.md","type":"markdown"},"created":["Talks/talk.pdf.md"],"filesBefore":5,"filesAfter":6}
```

**Suspected code:** `src/search/results.ts` `resolveHits()` maps hashes through `state.files`, which
only changes at index time. `src/main.ts` `openResult()` calls `workspace.openLinkText()`, which
creates a note for an unresolved link. Resolving against the live vault, or dropping missing
paths, and opening by `TFile` (`getLeaf().openFile(file, { eState: { subpath: '#page=N' } })`)
would avoid both problems.

### F7 (major): file names with `#` or `|` break opening and saved links

**Steps**

1. Rename `Talks/talk.pdf` to `Talks/Q3 #1 review.pdf`. Names like this are common, and Obsidian
   allows them.
2. Index, search for the hero query, and click the first result.
3. Run **Save results as note**.

**Expected:** the PDF opens at page 3, and the note's links resolve.

**Actual:** clicking **creates and opens an empty note `Talks/Q3.md`**. The saved note contains
`[[Talks/Q3 #1 review.pdf#page=3]]`, which Obsidian reads as a link to `Talks/Q3 ` (unresolved).
A file named `Docs/a|b.pdf` gives an unresolved link to `Docs/a`. Names with `^` and `[ ]`
resolve correctly. Same result on Obsidian 1.11.4 and latest.

**Evidence:** `tests/e2e/qa/links.qa.ts`:

```
QA F7 open: {"view":{"file":"Talks/Q3.md","page":null,"type":"markdown"},"created":["Talks/Q3.md"]}
QA F7 note: {..."unresolved":["Talks/Q3 "]}
QA F7 wikilinks: {"created":["Docs/a|b.pdf","Docs/v2^final.pdf","Docs/[draft] plan.pdf"],"unresolved":["Docs/a"]}
```

**Suspected code:** `src/search/links.ts` `pageLinkText()` / `wikiLink()` concatenate the raw path.
Open by `TFile` (see F8). For the note, use `app.fileManager.generateMarkdownLink()`, or a
markdown link with an angle-bracket path, which handles these characters.

### F2 (major): transparent PNGs are uploaded with their alpha channel and barely match

**Steps:** add a PNG with a transparent background and dark text. Exports from Figma, Keynote,
Excalidraw and many diagram tools look like this. It must be at most 512 KB and 1.3 MP. Index it,
then search for its text.

**Expected:** it ranks like the same image on white. The re-encode path already flattens onto
white ("re-encoded as JPEG on white", ADR-003).

**Actual:** passthrough uploads the original PNG with alpha. TopK appears to see dark text on a dark
background. Live scores for the query `quarterly revenue forecast`: same image on white **3.222**,
an unrelated control page 1.308, **transparent version 1.220**, below the unrelated page.

**Evidence:** the live probe above. `tests/qa/beta-1-findings.test.ts` › F2: `prepareImage` returns
the input bytes unchanged for a transparent PNG.

**Suspected code:** `src/render/pageSource.ts` `encodeImage()` passthrough condition. PNGs with an
alpha channel (colour type 4/6, or `tRNS`) should take the canvas path.

### F4 (major): a copied vault shares the vault id, and each copy deletes the other's pages

**Steps**

1. Index vault A.
2. Duplicate the vault folder, `.obsidian` included. People do this for a test copy, a backup they
   open, or a template. The brief itself recommends throwaway copies.
3. In copy B, delete `Talks/talk.pdf` and let it index.

**Expected:** vault A is unaffected.

**Actual:** both vaults use the vault id stored in `index-state.json`, so B's delete removes the
page ids A also uses. A still shows talk.pdf as indexed, but search no longer finds it. "Remove my
data" in either copy wipes both.

**Evidence:** `tests/qa/beta-1-findings.test.ts` › F4: A's hero search returns `Docs/handbook.pdf`
page 14 instead of `Talks/talk.pdf` page 3.

**Suspected code:** `src/indexer/state.ts` / `src/indexing.ts` `StateStore`. The vault id lives in
the plugin folder and is never checked against the vault it belongs to (for example
`app.appId` or the vault path).

### F5 (minor): a corrupt `index-state.json` gets a new vault id and orphans every upload

**Steps:** truncate `index-state.json`. `adapter.write` is not atomic and runs after every file, so
a crash or a forced quit mid-write can do this. Restart.

**Expected:** a re-index that reuses the vault id, or at least purges the old pages.

**Actual:** `JSON.parse` fails, `parseState(null)` makes a fresh vault id, and the whole vault is
uploaded again (charged again). The old pages remain under the old id forever. "Remove my data"
only deletes the new id, so the user can no longer remove the first copy from inside Obsidian.
Uninstalling and reinstalling the plugin has the same effect (see D2).

**Evidence:** `tests/qa/beta-1-findings.test.ts` › F5: after Remove, `expected 20 to be +0`.

**Suspected code:** `src/indexing.ts` `StateStore.load()` / `save()` (non-atomic write), and
`src/indexer/state.ts` `parseState()`. Keeping the vault id in `data.json` or writing via a temp
file and rename would contain it.

### F3 (minor): pages of a file that fails mid-render stay in TopK, untracked

**Steps:** a PDF whose page 3 fails to render, after pages 1–2 were buffered. Index it, then delete
the PDF and index again.

**Expected:** all of its pages are removed from TopK.

**Actual:** `record(job, 'failed')` copies `job.ids` when the failure happens. Pages 1–2 land later
in a shared batch, and their ids are pushed to the job but never saved. Deleting the file deletes
only the saved ids (none), so pages 1–2 stay in TopK. They are never shown, because their hash has
no path, but they cost storage and take top-20 slots before results are filtered.

**Evidence:** `tests/qa/beta-1-findings.test.ts` › F3: two untracked ids `v1:44a1…:1:0`, `…:2:0`.

**Suspected code:** `src/indexer/indexer.ts` `runIndex()` › `finishIfDone` / the Uploader
`onBatch` callback ignore failed jobs. They should still append to the saved entry's `ids`.

### F6 (minor): tall images make progress and the cost estimate wrong

**Steps:** add a 400×9000 px screenshot and index.

**Expected:** the first-run dialog and the status bar count its tiles.

**Actual:** the plan counts it as 1 page but uploads 18 tiles. The status bar shows, for example,
"Indexing 38 / 21 pages", and the cost estimate counts 1 embedding instead of 18.

**Evidence:** `tests/qa/beta-1-findings.test.ts` › F6: `expected 38 to be 21` (uploaded vs planned).

**Suspected code:** `src/indexer/indexer.ts` `planIndex()` (`kind === 'image' ? 1 : …`). Reading
the image header for its dimensions is cheap, and `tileRects()` gives the count.

### F11 (minor): changing the collection leaves the old one's pages behind

**Steps:** index, then change **Collection** in settings.

**Actual:** `parseState()` drops the hashes for the old collection (and any pending `needsPurge`).
The old collection keeps every page. "Remove my data" now only targets the new collection, so the
user must switch back to remove the old pages, and nothing tells them that. Each keystroke in the
field also saves a new valid collection name. Code: `src/indexer/state.ts` (`raw.collection !==
collection`), `src/settings.ts`.

### F12 (minor): queries over 4,096 characters show a raw TopK error

Live: `TopK rejected the request: Query text for field page_image exceeds maximum length of 4096
characters (got 14000)`. This is easy to hit by pasting a paragraph. Expected: limit or truncate
the input in `src/search/searchModal.ts`. Emoji, CJK and blank queries were fine.

### F13 (minor): search reopens with results from before "Remove my data"

`clearLocal()` sets `plugin.lastSearch = null`, but `removeData()` does not. The modal reopens
showing results for pages that are no longer in TopK, and "Save results as note" still saves them.
Code: `src/indexing.ts` `removeData()`.

### F14 (minor): identical files in two folders show only one path

`resolveHits()` takes `paths.get(hash)[0]`, the alphabetically first path. If `Archive/talk.pdf`
and `Talks/talk.pdf` are identical, results always open the archived copy, and the other one can
never be reached from search. Code: `src/search/results.ts`.

### F15 (minor): empty files share a hash across types, with a wrong failure reason

Node probe: `empty.pdf` and `empty.png` (0 bytes) share hash `e3b0c442…`. The PNG is skipped as a
duplicate, and Show index status lists it under the reason "The PDF file is empty, i.e. its size
is zero bytes." Code: `planIndex()` deduplicates by hash regardless of extension.

### F16 (minor): a file deleted during a run is reported as a failure

`vaultReader.read()` throws "`<path>` no longer exists", the file is recorded `failed`, and the end
notice says "1 failed". The next run then removes it cleanly. Expected: treat a file that no longer
exists as deleted, not failed. Code: `src/indexer/indexer.ts` `runIndex()` catch block.

### F17 (minor): an `http://` custom endpoint sends the key in cleartext

`endpointError()` accepts `http:`, and the key goes in the `authorization` header. That is fine for
the e2e mock on 127.0.0.1, but there is no warning for a remote host. Code: `src/settingsModel.ts`.

### D1 (docs, privacy): PRIVACY.md misstates what is uploaded

PRIVACY.md says "Each page is uploaded as a JPEG of at most 512 KB". In fact, PNG and JPEG files
within the limits are uploaded **byte for byte** (`encodeImage` passthrough). That includes PNG
text chunks and **JPEG EXIF metadata, such as GPS location, camera and timestamps**, for small
photos. Either strip metadata (re-encode) or document it.

### D2 (docs): nothing says the vault id lives in the plugin folder

Uninstalling the plugin (or a BRAT reinstall that drops the folder), duplicating a vault, or
syncing `.obsidian/plugins` between devices all change or share the vault id (F4, F5). README,
BETA.md and PRIVACY.md should say: run **Remove my data from TopK** before uninstalling, and do not
copy the plugin folder into another vault.

### D3 (docs): collection setting text promises a re-index that does not happen

"Changing it re-indexes the vault into the new collection." Nothing is triggered when the setting
changes. The re-index happens on the next file change or restart (with auto-indexing on), or when
the user runs Index vault. The old collection is not cleaned up (F11).

## Tested and found fine

- **API key:** absent from `main.js`, every tracked file and the e2e cache. `data.json` stores only
  the secret's name. `check:bundle` passes. The key's shape (45 mixed-case alphanumerics) is caught
  by the logger's fallback `KEY_SHAPED` mask as well as the registered-secret replacement. Debug
  log lines carry paths and counts only.
- **Malformed inputs:** 0-byte, garbage and truncated PDFs are recorded `failed` with a reason, and
  the rest of the vault indexes. A 200×200-inch page renders within the pixel budget. A
  zero-page PDF does not crash. A 1.3 MP noise PNG fits 512 KB after re-encode. An uppercase `.JPG`
  is indexed. A 400×9000 image tiles into 18 tiles. TopK accepts 1×1 and 10×14 px images.
- **File names:** `^` and `[ ]` in file names resolve (Obsidian 1.11.4 and latest).
- **Queries:** emoji, CJK and blank queries are fine against live TopK. An empty query is ignored
  client-side.
- **Renames:** with auto-indexing on, renames and moves re-use the hash at no cost (existing
  e2e/integration tests plus code review). Excluded folders drop their pages.
- **Concurrency guards:** two quick Index vault runs give "Indexing is already running.", and
  background runs are serialized by `ReindexScheduler`.
- **Release:** the released `manifest.json` carries version `0.1.0-beta.1`. The README's
  "$0.13 per 1,000 pages" matches `estimateCost(1000)` ($0.132).
- **Existing suite:** `npm test` passes (23 files, 128 tests), and the typecheck covers the new
  specs.

**Not tested:** encrypted PDFs (no tool here to make one), Windows/Linux, the BRAT install flow end
to end, note-name collisions on case-insensitive file systems, or the race specs on Obsidian
1.11.4.

## Triage (2026-11-19)

Checked against `main` at `32d13bf` (`0.1.0-beta.2`). Beta 2 testers reported no data-loss or
duplicate-result bugs, so this closes Stage 2.

**Fixed in 0.1.0-beta.2:** F1, F2, F4, F7, F8, F9, F10, F13, D1. The Node reproductions for F1 and
F4 were removed: F1 now indexes the misnamed image instead of failing it, and the F4 fix lives in
the plugin layer (`src/indexing.ts`), which the Node test bypassed. Both are covered by the regular
suite. The e2e specs for F7–F10 were not rerun.

**Fix before v1.0.0** (Stage 3, before the repo goes public):

| #   | Why before launch                                                                  | Repro        |
| --- | ---------------------------------------------------------------------------------- | ------------ |
| F5  | "Remove my data" misses earlier uploads after a corrupt state file                 | fails (Node) |
| F3  | Pages stay in TopK untracked after a failed render                                 | fails (Node) |
| F11 | Old collection keeps its pages, and "Remove my data" no longer reaches them        | none         |
| F6  | Cost preview undercounts tall images, and progress shows done > total              | fails (Node) |
| F17 | API key sent in cleartext to a remote `http://` endpoint without a warning         | none         |
| F12 | Pasting a long paragraph shows a raw TopK error                                    | none         |
| F16 | A file deleted mid-run is reported as failed                                       | none         |
| D2  | Say to run "Remove my data" before uninstalling, and not to copy the plugin folder | n/a          |
| D3  | Collection setting text promises a re-index that does not happen                   | n/a          |

**Deferred to Stage 4:** F14 (identical files in two folders open the first path only) and F15
(empty files share a hash). Both are cosmetic and lose no data.

## Summary

1. Two blockers. One misnamed image (PNG bytes in a `.jpg`) makes TopK reject the batch, so the
   vault never finishes indexing (F1). "Remove my data" is undone by the next restart or race (F10).
2. The maintenance commands check "is indexing running?" only before their dialog, which causes
   silent data loss (F9) and the removal race (F10).
3. Opening a result can create stray empty notes: stale paths after a rename (F8), and `#` or `|`
   in file names (F7).
4. Two search-quality and data-integrity holes: transparent PNGs are nearly invisible to the model
   (F2), and copied vaults share one vault id (F4).
5. 14 committed failing tests reproduce F1–F10 (`npx vitest run --project qa` and the
   `tests/e2e/qa/*.qa.ts` specs). The rest are minor or docs fixes.
