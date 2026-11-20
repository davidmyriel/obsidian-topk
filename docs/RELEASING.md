# Releasing

A release is a git tag on `main`; `.github/workflows/release.yml` does the rest. Only the
maintainer tags releases.

## Steps

1. **Version and changelog.** On a branch: `npm version X.Y.Z --no-git-tag-version`. This updates
   `package.json`, and its `version` hook (`scripts/version-bump.mjs`) updates `manifest.json` and
   `versions.json`. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z]` and add a new empty
   `## [Unreleased]` above it. That section becomes the release notes.
2. **Checks.** `npm run check` passes locally; open a PR and wait for `check` and `e2e-linux`.
3. **Manual QA.** Run `docs/QA.md` for the parts this release touches, and record the result in the
   PR. A change to the TopK schema also needs the upgrade checks, run on a real vault with an
   older index.
4. **Merge** the PR.
5. **Approval.** The maintainer approves the release.
6. **Tag** the merge commit with a bare version, no `v`:

    ```bash
    git tag -a X.Y.Z -m "X.Y.Z" <merge commit>
    ```

    ```bash
    git push origin X.Y.Z
    ```

    A tag with a suffix such as `X.Y.Z-beta.1` becomes a GitHub pre-release for BRAT testers. Its
    version is set in the released `manifest.json` only.

7. **Verify** that:
    - the Release workflow succeeded;
    - the release lists `main.js`, `manifest.json` and `styles.css`;
    - the released `manifest.json` has the new version;
    - `https://api.github.com/repos/davidmyriel/obsidian-topk/releases/latest` names it (BRAT reads
      this).

The workflow refuses a stable tag that doesn't match `manifest.json` and `versions.json` on the
tagged commit, and it runs `npm run check` again before publishing.
