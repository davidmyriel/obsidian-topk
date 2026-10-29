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
