# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [Unreleased]

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
