# Beta testing with BRAT

TopK Visual Search is in beta and installs through [BRAT](https://github.com/TfTHacker/obsidian42-brat)
(Beta Reviewers Auto-update Tool), which installs plugins straight from GitHub releases.

## Before you start

- Obsidian 1.11.4 or later, on desktop (macOS, Windows or Linux).
- A TopK account and API key from the TopK console. New accounts get $10 of free credits; indexing
  costs about $0.13 per 1,000 pages.
- Access to the repository while it is private (see below).

## Access while the repository is private

The repository belongs to a personal GitHub account, which affects testers in two ways:

- **Invitation:** the owner adds you as a collaborator (repository Settings → Collaborators). On a
  personal account's private repository GitHub only offers **write** access; read-only access needs
  the repository to move to an organization. Please do not push to it.
- **Token:** BRAT downloads releases with a GitHub personal access token. Fine-grained tokens are
  limited to resources of one owner, so for someone else's personal repository you will most likely
  need a **classic** token with the `repo` scope. That scope also covers your own private
  repositories, so give it a short expiry and revoke it when the beta ends. BRAT keeps it in
  Obsidian's secret storage.

## Install

1. In Obsidian, install and enable **BRAT** from Settings → Community plugins → Browse.
2. Create the token at GitHub → Settings → Developer settings → Personal access tokens → Tokens
   (classic), with the `repo` scope and an expiry. In Obsidian: Settings → BRAT → GitHub Personal
   Access Token, and add it.
3. Command palette → **BRAT: Add a beta plugin for testing**.
4. Repository: `davidmyriel/obsidian-topk`. Choose the latest version (or a specific beta, for
   example `0.1.0-beta.1`) and confirm. For a private repository, select your token for it.
5. Enable **TopK Visual Search** under Settings → Community plugins.

BRAT checks for new betas on startup and updates the plugin. Obsidian itself does not update beta
versions.

## First run

1. Settings → **TopK Visual Search**: add your API key (stored in Obsidian's secret storage), pick
   your TopK region, click **Test connection**.
2. Command palette → **TopK Visual Search: Index vault**. Read the dialog (pages, what is sent,
   estimated cost) and click **Start indexing**.
3. Command palette → **TopK Visual Search: Visual search**, describe a page, press Enter.

After that, the index updates itself when files change. See the README for all commands and
[PRIVACY.md](PRIVACY.md) for what leaves your device.

To stop testing, run **Remove my data from TopK** before you uninstall the plugin. The vault id it
needs lives in the plugin folder, which uninstalling deletes.

## Reporting

Use the issue templates: **Bug report** or **Beta feedback**. Include the output of
**Show index status**, never your API key. For bugs, the **Debug log** setting adds details to the
developer console without logging the key.
