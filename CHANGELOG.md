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
