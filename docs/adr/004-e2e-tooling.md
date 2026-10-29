# ADR-004: E2E tooling

- Status: Accepted by Dave on 2026-10-29
- Date: 2026-10-29
- Spike: `docs/spikes/D-e2e-harness.md`

## Decision

- **WebdriverIO 9 + `wdio-obsidian-service` 3.3.0**, Mocha, spec reporter. Pinned exact versions.
- Each run boots real Obsidian with `tests/fixtures/vault` and the plugin built from the repo root.
- Version matrix on every PR: `earliest` (= `minAppVersion` 1.11.4) and `latest`. Weekly macOS and
  Windows runs come with `nightly.yml`.
- Linux CI runs under `xvfb-run` and caches `.obsidian-cache`; confirmed on GitHub Actions on
  2026-10-29 (85 s).
- Code that must run inside Obsidian but isn't part of the plugin (spike probes, later test helpers)
  is bundled in `onPrepare` and loaded with `require()` through `browser.executeObsidian`.
- Specs that touch the network are opt-in (`E2E_SPIKES=1`); the default suite will talk to a local
  mock TopK gRPC server.
- `minAppVersion` is **1.11.4**, the first release with `SecretStorage` (`app.secretStorage`), so the
  API key can use Obsidian's secret storage without a fallback.
- CI audits shipped dependencies only: `npm audit --omit=dev --audit-level=high`. Dev-only advisories
  from the WebdriverIO toolchain are reviewed when WebdriverIO or the service is upgraded.

## Consequences

- E2E needs a display on Linux and downloads Obsidian (about 150 MB per version) on a cold cache.
- Upgrading to WebdriverIO 10 waits on `wdio-obsidian-service` supporting it.
- Using Obsidian's own downloads means the e2e suite tests the exact pdf.js that ships to users.

## Rejected

- **Playwright `_electron`:** works with Electron apps but needs us to locate, unpack and drive
  Obsidian ourselves; the service already handles versions, vaults and plugin installation.
- **Auditing dev dependencies at `high`:** CI would be red on toolchain advisories we cannot fix
  without leaving WebdriverIO 9.
