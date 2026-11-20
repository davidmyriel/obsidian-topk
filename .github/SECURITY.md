# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab
and choose **Report a vulnerability**. Don't open a public issue for them.

Useful things to include: the plugin version, what an attacker could do, and steps to reproduce.
Never include your TopK API key or private documents.

## Scope

In scope:

- **Credential leaks:** the API key ending up in logs, files or requests to the wrong host.
- **Unexpected data leaving the device:** anything sent beyond what `docs/PRIVACY.md` describes.
- **Code execution from vault content.**
- **Problems in the release artifacts.**

The plugin talks only to TopK (or a custom endpoint you set, which must use https unless it is on
your own machine). TopK's own service security is out of scope here; report it to TopK.

## Supported versions

Fixes go into the latest release. Update through BRAT, or by replacing the plugin files with the
latest release.
