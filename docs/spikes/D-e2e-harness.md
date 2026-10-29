# Spike D: end-to-end harness

Date: 2026-10-29.

## Setup

- WebdriverIO 9.32.0 (`@wdio/cli`, `local-runner`, `mocha-framework`, `spec-reporter`) with
  `wdio-obsidian-service` 3.3.0. Version 3.4.0 was two days old, and WebdriverIO 10 is outside the
  service's `webdriverio ^9.18.1` peer range, so both were held back.
- `wdio.conf.mts` boots Obsidian with the plugin from the repo root and the vault
  `tests/fixtures/vault`. It runs two versions: `earliest` (the manifest's `minAppVersion`, 1.11.4,
  with the oldest installer) and `latest` (1.14.5). `OBSIDIAN_VERSIONS=latest` narrows a local run.
  Downloads are cached in `.obsidian-cache/` (git-ignored, cached in CI).
- `npm run test:e2e` builds `main.js` first, then runs `tests/e2e/**/*.e2e.ts`.
- `onPrepare` bundles `tests/e2e/probe/probe.ts` to CommonJS, so spike specs can `require()` the
  real transport and renderer inside Obsidian's renderer process.

## Results (macOS arm64, local)

| Spec                                                                                | Obsidian 1.11.4 | Obsidian 1.14.5  |
| ----------------------------------------------------------------------------------- | --------------- | ---------------- |
| `plugin.e2e.ts`: plugin loaded, `Talks/talk.pdf` in the vault                       | pass            | pass             |
| `spikes.e2e.ts` A: gRPC transport from the renderer gets TopK's auth error (code 3) | pass, 85 ms     | pass, 108–126 ms |
| `spikes.e2e.ts` C: `loadPdfJs()` renders 3 pages at 3 sizes                         | pass            | pass             |

A full two-version run takes about 6 seconds once Obsidian is cached; the first run downloads it.
One run logged a chromedriver "Timed out receiving message from renderer" warning during the first
`loadPdfJs()` call; the test still passed. Worth watching for flakiness in CI.

`spikes.e2e.ts` is skipped unless `E2E_SPIKES=1`, because it calls the public TopK endpoint. The
regular e2e suite will use a local mock TopK server (PLAN.md testing strategy).

## Linux CI

`.github/workflows/ci.yml` has an `e2e-linux` job: `xvfb-run --auto-servernum npm run test:e2e` on
`ubuntu-latest`, with `.obsidian-cache` cached. First run on GitHub (2026-10-29, commit `b734353`):
passed in 85 s, covering index, search, opening page 3 and saving the results note. The `check` job
passed in 46 s.

## Audit

`npm audit` reports 18 high-severity advisories, all in the WebdriverIO 9 dev toolchain
(`extract-zip`, `basic-ftp`/`proxy-agent` via `@puppeteer/browsers`, `serialize-javascript` via
mocha). None reaches `main.js`; `npm audit --omit=dev --audit-level=high` reports 0. CI audits
shipped dependencies only. PLAN.md's CI row says `npm audit --audit-level=high`, so this is a
deviation for Dave to approve (ADR-004).
