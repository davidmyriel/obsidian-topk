# Contributing

Thanks for helping. Bug reports, search results that surprised you, and focused pull requests are
all welcome.

## Set up

- Node.js 24 (what CI uses) and npm.
- `npm ci`, then `npm run dev` to rebuild `main.js` on change. To try it, copy `main.js`,
  `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/topk-visual-search/` and reload
  Obsidian.
- A TopK API key is only needed for live tests and the benchmark. Put it in a git-ignored `.env` as
  `TOPK_API_KEY=…`. Never commit keys.

## Before a pull request

- **One change per PR, with tests.** Unit tests for logic, integration tests against the fake TopK
  for indexing, e2e (`npm run test:e2e`) for anything you click.
- **`npm run check` passes:** lint, typecheck, unit, integration and contract tests, build, and
  the bundle check.
- **Try it by hand in Obsidian** for user-facing changes, and say in the PR what you checked.
- **Record decisions and changes:** a lasting design decision gets an ADR in `docs/adr/`, and a
  user-visible change gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- **No new TopK schema fields without a migration plan.** TopK can't change a collection's schema,
  so ADR-006 describes how existing users move.

`AGENTS.md` has the same rules in short form for coding agents. `docs/ARCHITECTURE.md` explains how
the pieces fit.

## Reporting bugs

Use the issue forms. Include the output of **Show index status** and, if useful, the **Debug log**
from the developer console. Both are free of your API key, but they can contain file names.
Describe a private page instead of attaching it.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.
