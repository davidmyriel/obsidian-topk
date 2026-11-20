# TopK Visual Search for Obsidian — Project Plan

Oct 29, 2026 · @Dave

## Goal and handoff instructions

Build an Obsidian desktop plugin that finds the exact PDF page or image in a vault from a plain-language query. It uses TopK's hosted topk-embed-v1 image embeddings and its multi-vector (MaxSim) index. The plugin is TopK's developer demo, so success is new TopK API keys, not installs.

Example of the promise: a query for "slide with the reranker architecture diagram" returns `talk.pdf`, page 15, at rank 1. The user clicks it and Obsidian opens that page.

### Success targets (proposed, confirm with Dave)

| Measure | Target |
| --- | --- |
| Benchmark Recall@1, page level | Highest of the three setups: OCR + BM25, Gemini 6-page chunks, TopK |
| Hero query | Correct page at rank 1 |
| Query latency, end to end | p95 under 1.5 s |
| Re-index of an unchanged vault | Zero embedding calls |
| GitHub stars before community store submission | 300 |
| New TopK API keys, 2 weeks after launch | Baseline agreed with TopK before launch |

### Non-goals

- Mobile indexing (Stage 4 may add search-only on mobile)
- OCR, text chunking or parsing before embedding: whole page images are the search unit
- Chat answers or RAG inside the plugin before Stage 4
- Running a local model before Stage 4

### Rules for the Claude Code instance

Current, shorter rules for any agent are in `AGENTS.md`; these are the original rules for Stages 0–3.

1. Work one stage at a time. Start the next stage only when the current stage's exit criteria pass.
2. One task per branch and PR. Every PR adds tests, and `npm run check` (lint, typecheck, unit, contract, integration, build) is green.
3. Never guess TopK SDK or API names. Read the installed `topk-js` package (Dave has 0.16.1 locally) and docs.topk.io, then record findings in `docs/spikes/`.
4. Never commit keys. CI uses recorded fixtures and a fake TopK; live tests run only when `TOPK_API_KEY` is set.
5. Record each lasting decision as an ADR in `docs/adr/`, and keep `CHANGELOG.md` current.
6. Ask Dave before publishing a release, posting anywhere, submitting to the Obsidian store, or changing the TopK schema after beta.

## Architecture

The plugin is a pipeline from vault files into TopK, plus a search path that maps TopK hits back to local paths.

&#91;embedded content: plugin architecture · indexing, search, results\]

Indexing runs once per changed file. A search sends only the query text, and results come back as content hashes that local state turns into today's file paths.

### Core interfaces

- `TopKClient`: `ping()`, `upsertPages(pages)`, `deletePages(ids)`, `search(query, k, filter)`. It has two implementations, the real HTTP or SDK client and the in-memory fake used in tests.
- `PageSource`: yields `{contentHash, page, tile, png, textLayer?}` for a file, one page at a time.
- `IndexState`: persisted map of content hash to paths, page count, TopK ids and status.

### TopK document schema (proposed; Spike B confirms field types)

| Field | Type | Example |
| --- | --- | --- |
| `_id` | string: content hash, page, tile | `9f2c41a0:15:0` |
| `vault_id` | string, filterable | a random UUID per vault |
| `content_hash` | string | `9f2c41a0…` (SHA-256) |
| `page` | integer | `15` |
| `tile` | integer | `0` |
| `kind` | string | `pdf_page`, `image`, `image_tile` |
| `embedding` | matrix field with a MaxSim multi-vector index | from topk-embed-v1 |
| `text` | optional string with a keyword index | off by default |

A search embeds the query with the same model, filters by `vault_id` and asks for the top 20. The plugin drops hashes that no longer have a path, then shows the top 10.

## Repo layout and stack

Use TypeScript in strict mode, built with esbuild from the official `obsidianmd/obsidian-sample-plugin` template. The plugin ships as one `main.js` with `isDesktopOnly: true`.

| Concern | Choice |
| --- | --- |
| Language and build | TypeScript strict, esbuild, npm, Node LTS |
| PDF rendering | Obsidian's bundled pdf.js through `loadPdfJs()`; `pdfjs-dist` in Node tests |
| HTTP | Obsidian `requestUrl`, which avoids CORS. Use `topk-js` only if Spike A shows it bundles into Electron |
| Unit and integration tests | Vitest |
| End-to-end tests | WebdriverIO with `wdio-obsidian-service` (confirm in Spike D) |
| Lint and format | ESLint with Obsidian's official plugin rules, Prettier |
| Benchmark | TypeScript scripts in `bench/`: tesseract.js + MiniSearch for the OCR baseline, Gemini API, TopK |

```
obsidian-topk-visual-search/
  src/
    main.ts              plugin entry, commands, ribbon icon
    settings.ts          settings tab and validation
    indexer/             scanner, changeDetector, queue, state
    render/              pdfRenderer, imagePrep, tiler, textLayer
    topk/                TopKClient interface, httpClient, schema, embedder
    search/              searchModal, resultView, links
    util/                hash, logger (redacts keys), errors, cost
  tests/
    unit/  contract/  integration/  e2e/  live/
    fixtures/vault/      small licensed PDFs and images
    fixtures/topk/       recorded TopK requests and responses
  bench/
    corpus.json  queries.jsonl  runners/  report/
  docs/
    adr/  spikes/  PRIVACY.md  ARCHITECTURE.md
  scripts/smoke.ts
  manifest.json  versions.json  CHANGELOG.md
  .github/workflows/  ci.yml  nightly.yml  release.yml
```

Use conventional commits (`feat:`, `fix:`, `test:`). Avoid `any`, and keep `obsidian` imports out of `indexer/`, `render/` and `topk/`. That way the core runs in plain Node tests without starting Obsidian.

## Stage 0: setup and spikes (about 3 days)

This stage replaces every unknown with a written answer before any feature code. Each spike ends as an ADR plus a short script that proves it.

- [ ] Scaffold from the sample plugin. Add scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:contract`, `test:live`, `test:e2e`, `bench`, `check`.
- [ ] CI skeleton: `check` runs on every PR.
- [ ] **Spike A, SDK in Obsidian:** try bundling `topk-js` 0.16.1 into `main.js` and calling it from the Electron renderer. If it is a native addon or won't bundle, call TopK's HTTP API through `requestUrl`. Output: ADR-001 "TopK transport".
- [ ] **Spike B, image embedding:** find the exact request that embeds one page image with topk-embed-v1. Decide whether TopK embeds on upsert or the plugin embeds first, then upserts the matrix. Record image formats, size limits, tokens and price per page. Save real request/response pairs into `tests/fixtures/topk/`. Output: ADR-002 "Embedding and schema".
- [ ] **Spike C, rendering:** render one PDF page to PNG with `loadPdfJs()` inside Obsidian. Measure ms per page and peak memory at 3 resolutions (long side 1024, 1536, 2048 px). Pick the smallest that keeps the hero query at rank 1. Output: ADR-003 "Render settings".
- [ ] **Spike D, e2e harness:** boot Obsidian with `tests/fixtures/vault` in CI (Linux, xvfb) and run one assertion. Output: ADR-004 "E2E tooling".

**Exit criteria:** four ADRs merged. `npx tsx scripts/smoke.ts` indexes 3 fixture pages into a temporary TopK collection and returns the correct page for one query. CI is green.

## Stage 1: MVP (about 1 week)

The MVP indexes a vault on command, searches it and opens the matching page. Indexing is manual; live updates come in Stage 2.

### Features

1. **Settings:** TopK API key (Obsidian secret storage if the target `minAppVersion` has it, otherwise plugin data with a visible warning), region or endpoint, collection name, include folders, exclude globs, max pages per file (default 300). Add a "Test connection" button.
2. **Command "Index vault":** scans `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`. It renders each page and sends it to TopK. Show progress in the status bar ("Indexing 214 / 1,032 pages") and offer a Cancel button.
3. **Skip unchanged files:** a local state file maps content hash to page count and TopK ids. Running Index twice in a row makes zero embedding calls the second time.
4. **Command "Visual search":** a modal with a query box. It shows the top 10 results with a thumbnail, file name, page number and a one-line snippet from the PDF text layer. Use the snippet for display only, never as embedding input.
5. **Open result:** a PDF opens at the page via the link `talk.pdf#page=15`; an image opens the file.
6. **Command "Save results as note":** writes a note listing the results as `[[talk.pdf#page=15]]` links.
7. **Missing key:** if no API key is set, the plugin shows a notice and links to settings, without throwing errors.

### Tests that must exist by the end of Stage 1

- Unit: page link builder, document id and hashing, include/exclude glob matching, settings validation, local state read and write.
- Contract: the TopK client sends exactly the recorded request shapes from Spike B and parses the recorded responses.
- Integration: the full index pipeline on the fixture vault with a fake TopK (in-memory). It asserts page counts, document ids and zero calls on re-index.
- Live: index 20 fixture pages into a throwaway collection; the hero query returns the right page at rank 1; delete the collection afterwards.
- E2E: open Obsidian, run Visual search, click result 1, assert the PDF view is on the expected page.

**Exit criteria:** all tests above are green in CI. Dave runs it on his own vault and the hero query works. A 30-second demo GIF is recorded.

## Stage 2: beta hardening (1 to 2 weeks)

The beta keeps the index correct as the vault changes and survives real vaults of 5,000+ pages. It ships to 5 to 10 testers through BRAT.

- [ ] **Live updates:** listen to vault create, modify, rename and delete events, with a 5-second debounce. Re-embed only files whose content hash changed.
- [ ] **Free renames:** TopK document ids come from the content hash plus page number, not the path. The local state maps hash to current path, so renaming or moving a file costs nothing. Identical files are stored once.
- [ ] **Deletes:** removing a file deletes its pages from TopK. A "Rebuild index" command wipes and re-indexes.
- [ ] **Durable queue:** the work queue is saved to disk, so closing Obsidian mid-index resumes where it stopped.
- [ ] **Network resilience:** retries with exponential backoff and jitter on 429 and 5xx. Concurrency is a setting (default 4). When offline, the plugin pauses and resumes without data loss.
- [ ] **Tall images:** split images taller than 2.5 times their width into page-sized tiles with 10% overlap. Results point to the parent image.
- [ ] **Cost preview:** before the first full index, show "1,032 pages, about 1.3M tokens, about $0.06". Use the per-page token figure measured in Spike B.
- [ ] **Large files:** stream pages one at a time to cap memory. Warn and skip files above the page limit.
- [ ] **Errors:** a status panel lists failed files with a reason and a Retry button. A debug log toggle never prints the key.
- [ ] **Beta release:** README with GIF and privacy section, issue templates for bug and feedback, a BRAT install guide.

**Tests added:** unit tests for the debounce, queue persistence, backoff timings (fake timers), tiling math and cost estimate. Integration tests for rename, move, delete and edit on the fixture vault against the fake TopK. A crash-resume test that kills the indexer at page 50 and asserts the restart finishes with no duplicates. A load test that indexes 5,000 synthetic pages against the fake TopK under a memory ceiling.

**Exit criteria:** testers report no data-loss or duplicate-result bugs for 7 days, and every open bug is labelled and triaged.

## Stage 3: benchmark and launch (about 1 week)

The benchmark is the launch asset. It runs the same queries through three setups and reports page-level accuracy.

### Corpus and queries

- About 50 files and 1,000 pages, all licensed for redistribution: CC-BY arXiv papers, Dave's own slide decks, scanned notes and whiteboard photos he owns. Record source and licence per file in `bench/corpus.json`.
- 50 queries in `bench/queries.jsonl`. Each has the correct file and page (or pages) and a category: diagram, chart, table, handwriting, screenshot, plain text. Plain-text queries are the control.
- Two people label the correct pages independently and resolve disagreements before results are run.

### Setups compared

| Setup | What it reproduces |
| --- | --- |
| OCR + BM25 | Omnisearch with Text Extractor: tesseract.js plus pdf.js text, MiniSearch ranking |
| Gemini Embedding 2, 6-page chunks | LLM Hub's default |
| Gemini Embedding 2, 1-page chunks | LLM Hub at its best setting |
| TopK, topk-embed-v1, one entry per page | This plugin, using its own indexing code |

Report Recall@1, Recall@5, nDCG@10, MRR, index time and cost per 1,000 pages, both overall and per category. `npm run bench` writes `bench/report/report.md` plus charts. It also saves a side-by-side screenshot of the hero query in all four setups.

### Launch checklist

- [ ] Blog post, with the hero side-by-side as the first image and the results table second
- [ ] Public repo: README, GIF, benchmark instructions, licence (MIT)
- [ ] GitHub release v1.0.0, installable through BRAT
- [ ] Same corpus loaded into vectorsearch.tech, so readers can try the hero query without installing
- [ ] Posts drafted for Dave to publish: Show HN, r/ObsidianMD, Obsidian forum "Share & showcase", X
- [ ] Tracking: count new TopK API keys for 14 days, with the UTM link from the post

**Exit criteria:** the benchmark reruns from a clean clone with one command, and Dave approves the post.

## Stage 4: advanced (after launch, ordered by expected impact)

Build these only after launch numbers come in. Each one gets its own ADR, tests and a benchmark rerun.

| Feature | What the user sees | Depends on |
| --- | --- | --- |
| Find similar pages | Right-click a page or image, choose "Find visually similar", get the 10 closest pages | Querying with a page's own vectors. **On hold (Dave, 2026-10-30).** |
| Exact text matching (hybrid ranking) | Quoted phrases and codes like "INV-2291" put pages that contain them first; other queries stay visual. Design: ADR-006 (proposed) | A `-text` collection with a TopK keyword index; spike in ADR-006 |
| Excalidraw and Canvas | Drawings from the Excalidraw plugin and Canvas files are rendered to PNG and searchable | Excalidraw export API |
| Match heatmap | The result thumbnail highlights the patches that matched the query | TopK returning per-token MaxSim scores (open question) |
| Zotero folder | Index a Zotero storage folder outside the vault, results link back to the PDF | Read access outside the vault |
| Local encoding option | Pages are embedded on the laptop with topk-embed-v1-xsmall; only vectors go to TopK | ONNX or MLX runtime in Electron |
| Mobile search only | Query from phone against an index built on desktop | A query path with no rendering |
| Ask about results | Send the top 3 page images to a vision model with the question and show the answer with page links | User's own model key |
| Community store listing | One-click install from Obsidian | Stage 3 traction gate: 300 stars or clear forum demand |

## Testing strategy

Tests run in layers from fast and offline to slow and live, so every PR is checked without spending TopK credits.

| Layer | Tool | What it covers | When it runs |
| --- | --- | --- | --- |
| Unit | Vitest | Pure logic: links, ids, globs, tiling, cost, backoff, debounce, settings | Every PR, under 30 s |
| Contract | Vitest + recorded fixtures | Request shapes sent to TopK and parsing of its responses, including error bodies | Every PR |
| Integration | Vitest + fake TopK + `pdfjs-dist` in Node | Full index and search pipeline on the fixture vault: create, edit, rename, delete, resume | Every PR |
| End-to-end | WebdriverIO + wdio-obsidian-service | Real Obsidian with the fixture vault and a local mock TopK server: commands, modal, opening page 15 | Every PR on Linux; weekly on macOS and Windows |
| Live | Vitest + real TopK | Throwaway collection per run, hero query at rank 1, cleanup afterwards | Nightly and before each release |
| Benchmark regression | `npm run bench` | Recall@5 on the full corpus; fail if it drops more than 2 points from the last release | Nightly and before each release |
| Manual QA | Checklist in `docs/QA.md` | macOS, Windows, Linux; a 5,000-page vault; going offline mid-index; a vault with no PDFs | Before each release |

**Fake TopK:** an in-memory implementation of the same `TopKClient` interface. It returns deterministic vectors per fixture page, so integration tests can assert exact rankings.

**Coverage target:** 80% lines on `indexer/`, `render/` and `topk/`; UI code is covered by end-to-end tests instead.

**Bug rule:** every fixed bug gets a failing test first, then the fix, in the same PR.

## CI/CD and releases

GitHub Actions runs three workflows. A release is a git tag; nothing ships from a laptop.

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Every PR and push to `main` | Install with lockfile, lint, typecheck, unit, contract, integration, build, bundle size check (fail above 1.5 MB), e2e on Linux, `npm audit --audit-level=high` |
| `nightly.yml` | Daily, plus manual | Live tests and benchmark with the `TOPK_API_KEY` secret; e2e on macOS and Windows; posts results as a workflow summary |
| `release.yml` | Tag `vX.Y.Z` | Check that the tag matches `manifest.json` and `versions.json`, build, attach `main.js`, `manifest.json`, `styles.css` to a GitHub release, paste the CHANGELOG entry as release notes |

Use semantic versions. Beta builds are tagged `vX.Y.Z-beta.N` and installed through BRAT.

**Community store submission (Stage 4 gate only):** open a PR to `obsidianmd/obsidian-releases` adding the plugin to `community-plugins.json`. Before that, check the plugin against Obsidian's developer policies and plugin guidelines. The README must state network use, that a TopK account is required, and that it is a paid service with free credits.

## Security and privacy

Only page images, their embeddings and optional snippet text leave the machine. File names and folder paths stay local, because TopK ids come from content hashes.

| What | Goes to TopK? | Notes |
| --- | --- | --- |
| Page images | Yes, for embedding | Disclosed in README, settings and the first-run dialog |
| Embeddings | Yes, stored | Deleted by "Remove my data from TopK" |
| PDF text layer | Only if "Store text for snippets and keyword search" is on | Off by default; snippets are read locally from the file |
| File names and paths | No | Kept in local state as hash → path |
| API key | Sent only as the auth header to the TopK endpoint | Never logged; the logger redacts anything shaped like a key |
| Usage analytics | No | No telemetry, as Obsidian's policies require |

- Default exclude globs: `.obsidian/**`, `.trash/**`. Users add their own, for example `Private/**`.
- A first-run dialog shows what will be sent and the cost estimate. Nothing is uploaded until the user clicks "Start indexing".
- Commands "Remove my data from TopK" (deletes the collection) and "Clear local index".
- `requestUrl` calls only the configured TopK endpoint; a unit test fails if any other host appears in the bundle.
- Pinned dependencies, a committed lockfile, `npm audit` in CI, and no dynamic `eval` or remote code.
- `docs/PRIVACY.md` holds the plain-language version of this table.

## Risks, open questions and definition of done

The two biggest risks are settled in Stage 0: whether the SDK runs inside Obsidian, and the exact image embedding call.

| Risk | Effect | Fallback |
| --- | --- | --- |
| `topk-js` is a native addon and won't bundle | No SDK in the plugin | Call TopK's HTTP API through `requestUrl` behind the same `TopKClient` interface |
| Image embedding request differs from what the plan assumes | Schema and indexer change | Spike B decides before Stage 1; the `Embedder` interface hides the difference |
| pdf.js runs out of memory on 1,000-page PDFs | Crash mid-index | Render one page at a time, release each canvas, enforce the page cap |
| An Obsidian update breaks the plugin | Broken for users | Pin `minAppVersion`, run e2e weekly on the latest Obsidian |
| Users balk at vault data leaving the machine | Bad comments at launch | Clear disclosure, paths stay local, Stage 4 local encoding option |
| A newer model beats topk-embed-v1 | Weaker headline | Compare only against what Obsidian users have today |

### Open questions for Dave and TopK

- [x] How is image embedding billed: tokens per image, or a flat price per image? **Flat: $0.075 per 1,000 images (TopK blog). See docs/spikes/E-topk-embed-v1.md.**
- [x] Can demo users get extra free credits or a promo code tied to the post? **New accounts get $10 of free credits (topk.io/pricing), about 65,000–110,000 indexed pages.**
- [ ] Does search return per-token MaxSim scores, needed for the Stage 4 heatmap?
- [ ] One collection per user, or one shared collection with a filter per vault?
- [ ] Which of Dave's slide decks and notes can go into the public corpus?
- [ ] What launch date fits TopK's own announcement calendar?

### Definition of done (every stage)

- [ ] Exit criteria in the stage section pass
- [ ] `npm run check` green in CI, nightly green for 2 days running
- [ ] ADRs written for every decision taken in the stage
- [ ] README, `docs/ARCHITECTURE.md` and `CHANGELOG.md` updated
- [ ] Demo GIF or screenshots refreshed if the UI changed
- [ ] Dave has reviewed and signed off
