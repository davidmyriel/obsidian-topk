# Agent instructions

Obsidian desktop plugin: visual search over PDF pages and images, backed by TopK. Read README.md
first; `docs/ARCHITECTURE.md` and `docs/adr/` explain the design.

## Commands

- `npm run check`: lint, typecheck, unit, integration and contract tests, and build. It must pass
  before every PR.
- `npm run test:e2e`: real Obsidian with a mock TopK.
- `npm run bench:fetch && npm run bench`: the retrieval benchmark (`bench/README.md`).

## Rules

- Never commit API keys. Live tests and the benchmark read `TOPK_API_KEY` (and `GEMINI_API_KEY`)
  from the environment or the git-ignored `.env`.
- File names and paths never leave the device; only page images, page text and queries go to TopK.
- Talk to TopK through `src/topk/` (its own gRPC client over Node `http2`, see ADR-001); Obsidian's
  `requestUrl` cannot do HTTP/2. Don't guess API names: check `vendor/topk-protos` and
  docs.topk.io.
- TopK collection schemas can't be changed. A schema change needs a migration (ADR-006) and the
  maintainer's approval.
- One change per branch and PR, with tests. Record lasting decisions as an ADR in `docs/adr/` and
  user-facing changes in `CHANGELOG.md`.
- Ask the maintainer before tagging a release, posting anywhere or submitting to the Obsidian store.
