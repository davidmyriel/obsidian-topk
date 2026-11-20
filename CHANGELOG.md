# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [Unreleased]

## [1.1.0]

### Improved

- Searches of one or two words also match file names, so "map" finds `Larousse world map.jpg` even
  though the image model ranks a one-word description poorly. Files whose name contains the words
  move to the top and are marked "matched by file name". Matching runs on your device; file names
  still never leave it.
- A one-word search shows a tip to describe the page in a few words, which ranks far better.

## [1.0.0]

The first stable release. Find the PDF page or image in your vault by describing it; see the README
for what it does and how it compares with text search. Upgrading from a beta keeps your index.

### Added

- A reproducible benchmark (`bench/`): 35 CC BY papers and slide decks (1,026 pages), 100 queries
  in two tiers, and runners for text search (Omnisearch with Text Extractor), Gemini Embedding 2
  and this plugin. `npm run bench:fetch && npm run bench` reruns it.
- MIT licence.

### Fixed

- A corrupt index state file no longer orphans uploads: the vault id is also kept in the plugin's
  settings, so re-uploads overwrite the earlier pages and **Remove my data** still reaches them.
- Changing the **Collection** setting now cleans up: the next index deletes this vault's pages from
  the old collection, and **Remove my data** covers old collections too. The setting saves when you
  leave the field, not on every keystroke.
- Pages of a file that failed partway through stay tracked, so deleting or fixing the file removes
  them from TopK.
- Tall images are counted by their tiles before upload, so the cost preview and progress are right.
  A tall image over the page limit is skipped, like a long PDF.
- A file deleted while indexing runs is no longer reported as failed.
- Queries are limited to 4,096 characters instead of showing a TopK error.
- A custom endpoint must use https unless it is on this computer, so the API key is never sent
  unencrypted. A saved remote `http://` endpoint is dropped and the region's endpoint is used.

### Documentation

- README, BETA.md and PRIVACY.md say to run **Remove my data from TopK** before uninstalling.

## [0.1.0-beta.2] - 2026-10-30

Fixes from an outside tester's review of beta 1. Existing indexes keep working. Images uploaded by
beta 1 stay as they were until the file changes; run **Rebuild index** to re-send them without photo
metadata and with transparent PNGs fixed.

### Fixed

- One misnamed image (a PNG saved as `.jpg`) no longer stops the whole vault from indexing. Images
  are decoded by their bytes, and if TopK rejects a page, only that file is marked failed.
- **Remove my data from TopK** now sticks: it stops any run, withdraws upload consent and clears the
  last results, so neither a restart nor a file change re-uploads the vault.
- **Rebuild index**, **Remove my data** and **Clear local index** confirmed during indexing no longer
  leave search empty or undo themselves: they stop the run and wait before changing the index.
- Results follow renames immediately, drop deleted files, and open the file directly, so clicking a
  result can no longer create an empty note.
- File names with `#` or `|` open correctly; saved notes use links that resolve (an
  `obsidian://open` link for names with `#`, which Obsidian links cannot contain).
- Transparent PNGs are flattened onto white before upload, so they match searches.
- A copied vault gets its own vault id, so the copy and the original no longer delete each other's
  pages.
- Privacy: every image is redrawn before upload, so photo metadata such as GPS location is no longer
  sent. PRIVACY.md says so.

## [0.1.0-beta.1] - 2026-10-30

First beta, for testers installing through BRAT (see docs/BETA.md).

### Highlights

- **Visual search:** describe a page ("slide with the reranker architecture diagram") and get the
  matching PDF pages and images with thumbnails; click to open the PDF at that page.
- **Index vault** uploads page images to your own TopK project, shows the page count and estimated
  cost first, and then keeps the index up to date as files change.
- Renames are free, deleted files are removed from TopK, interrupted runs resume, and indexing
  pauses while offline.
- **Show index status**, **Rebuild index**, **Remove my data from TopK**, **Clear local index**,
  **Save results as note**.
- Desktop only; Obsidian 1.11.4 or later. Needs a TopK API key (new accounts get $10 of credits;
  about $0.13 per 1,000 pages).

### Added

- Project scaffold from `obsidianmd/obsidian-sample-plugin`: strict TypeScript, esbuild, ESLint with the
  Obsidian rules, Prettier, Vitest projects (unit, contract, integration, live) and the `check` script.
- CI workflow running `npm run check` on every pull request and push to `main`.
- Spike A: minimal gRPC client over Node `http2` (`src/topk/grpc.ts`) with a codec generated from
  TopK's v0.16.1 protos (vendored in `vendor/topk-protos`). ADR-001 "TopK transport" (proposed).
- PDF page renderer (`src/render/pdfRenderer.ts`) with injected pdf.js and canvas, and a generated,
  redistributable fixture vault (`scripts/make-fixtures.ts`).
- Spike B: TopK request builders for collection create, page upsert (server-side image embedding),
  search and delete (`src/topk/requests.ts`), `scripts/smoke.ts` with `--record` for live fixtures,
  and contract tests that activate once fixtures are recorded. ADR-002 "Embedding and schema"
  (proposed).
- Spike C: rendering measurements in Node and inside Obsidian (`scripts/spike-c-render.ts`), DOM
  canvas factory for Obsidian (`src/util/domCanvas.ts`). ADR-003 "Render settings" (proposed).
- Spike D: WebdriverIO + `wdio-obsidian-service` e2e harness booting Obsidian 1.11.4 and latest with
  the fixture vault, opt-in in-Obsidian spike specs, and a Linux `xvfb` e2e job in CI.
  `minAppVersion` set to 1.11.4 for `SecretStorage`. ADR-004 "E2E tooling" (proposed).
- Live Stage 0 smoke run: hero page at rank 1 at 1024, 1536 and 2048 px. Recorded TopK fixtures
  (account ids redacted) now drive the contract tests. ADR-003 default long side set to 1024 px.
- ADR-001 to ADR-004 accepted. `docs/PRIVACY.md` states that page images are stored in TopK.
- `TopKClient` interface with the gRPC implementation (`src/topk/grpcClient.ts`): collection
  create-or-validate, byte-budgeted upsert batches, search, delete, and user-facing error kinds.
  In-memory `FakeTopK` and a local mock TopK gRPC server for tests. Redacting debug logger.
- Indexer core (`src/indexer`): include folders and exclude globs, persisted index state keyed by
  content hash, and a pipeline that hashes only changed files, renders PDF pages and images
  (WebP re-encoded to JPEG), uploads in bounded batches, checkpoints after every file, supports
  cancel, and makes zero TopK calls when nothing changed. Fixture vault grown to 20 pages.
- Settings tab: TopK API key in Obsidian's secret storage, region, collection, include folders,
  exclude patterns (default: the vault's config folder and `.trash`), max pages per file (300),
  page image size, custom endpoint, debug log, and a "Test connection" button. A missing key shows
  a notice that links to settings.
- "Index vault" command: scans the vault, asks before the first upload (files, pages and what is
  sent), shows "Indexing 214 / 1,032 pages" in the status bar with a Cancel link, and reports a
  summary. "Cancel indexing" command. Index state is saved to `index-state.json` in the plugin
  folder. E2E suite now runs against a local mock TopK server.
- "Visual search" command and ribbon icon: a modal that shows the top 10 pages with a thumbnail,
  file name, page number and a one-line snippet from the PDF's local text layer; click or Enter
  opens the PDF at that page (`talk.pdf#page=15`) or the image. Results whose file was deleted are
  dropped. "Save results as note" writes the results as `[[file.pdf#page=N]]` links. E2E covers
  search → click → PDF on page 3, and saving the note.
- Live test: indexes the 20 fixture pages into a throwaway collection with the real pipeline and
  checks the hero query ranks first, then deletes the collection. `nightly.yml` runs it with the
  `TOPK_API_KEY` secret, plus e2e on macOS and Windows.
- README with usage, network use and install instructions; `docs/ARCHITECTURE.md`.
- Windows e2e runs the minimum Obsidian (1.11.4) on the latest installer; the oldest installer
  crashes when drawing any PDF on GitHub's Windows runners, Obsidian's own viewer included.
- Pages are rendered to topk-embed-v1's pixel budget (1,310,720 px, about 1.3 MP) instead of a 1024 px
  long side, so slides and A4 pages both give the model full detail. The "Page image size" setting
  now offers "Full detail (1.3 MP)" and "Smaller uploads (0.66 MP)". Pages indexed earlier keep their
  old renders until the file changes. Pricing and resolution findings are in
  `docs/spikes/E-topk-embed-v1.md`.
- Network resilience: TopK calls retry like the official SDK (connection errors 3 times with
  jittered backoff from 100 ms to 10 s, read-after-write for 2 s), plus a longer backoff when TopK
  asks clients to slow down. Quota errors stop indexing with a message to check credits. If TopK
  stays unreachable, indexing pauses ("Offline, will resume…") and continues when the connection
  returns. Uploads run in parallel ("Parallel uploads" setting, default 4) and a file counts as
  indexed only when all its pages have landed.
- Deletes: indexing removes pages of files that were deleted, changed or excluded from TopK (no
  calls when nothing changed; a file that can't be read is kept). New commands **Rebuild index**,
  **Remove my data from TopK** (deletes only this vault's pages) and **Clear local index**, each
  with a confirmation.
- Fix: TopK ids now include the vault id (`vault:hash:page:tile`), so vaults sharing a collection
  and a file no longer overwrite each other's pages. Existing indexes migrate on the next run:
  this vault's old pages are deleted and uploaded again.
- Live updates (ADR-005): the index updates itself 5 seconds after PDFs or images are added,
  changed, renamed or deleted, and when Obsidian starts, catching changes made while it was closed.
  Background runs stay quiet unless something fails. Setting **Index automatically** (on by
  default). An interrupted file now resumes after its last uploaded page instead of starting over.
- Tall images: images more than 2.5 times taller than wide (long screenshots, infographics) are
  split into page-shaped tiles (width × 1.414) with 10% overlap, each scaled to the full pixel
  budget. Tiles are stored as `image_tile` and appear as one search result that opens the image.
  The max-pages-per-file limit also caps tiles.
- Cost preview: the first-upload and Rebuild dialogs show an estimate from TopK's list prices
  ($0.075 per 1,000 image embeddings plus upload and storage; about $0.13 per 1,000 pages).
- **Show index status**: files and pages indexed, partly uploaded files, and failed and skipped
  files with their reasons, with **Retry failed**. A file that fails is no longer retried on every
  run; it waits until it changes or you retry.
- Stress tests: a crash at page 50 of a 120-page file, restarted from the last saved state,
  finishes with every page exactly once and re-uploads at most the pages that were in flight; a
  5,000-page load test holds retained memory to about 10 MB (heap plus buffers, measured after
  garbage collection) while 586 MB of page images pass through, in 143 requests.
- Beta release tooling: `release.yml` publishes a GitHub release from a version tag (no `v` prefix,
  as Obsidian expects; pre-release tags such as `0.1.0-beta.1` become GitHub pre-releases for BRAT),
  with notes from this changelog. `docs/BETA.md` (BRAT install, including private-repo tokens),
  `docs/QA.md` (manual release checklist), and bug and feedback issue templates.
- Bundle check in CI: `main.js` must stay under 1.5 MB, reference no host other than TopK's
  regional endpoints, and contain no `eval` or `new Function`.
