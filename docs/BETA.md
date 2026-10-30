# Beta testing with BRAT

TopK Visual Search is in beta and installs through [BRAT](https://github.com/TfTHacker/obsidian42-brat)
(Beta Reviewers Auto-update Tool), which installs plugins straight from GitHub releases.

## Before you start

- Obsidian 1.11.4 or later, on desktop (macOS, Windows or Linux).
- A TopK account and API key from the TopK console. New accounts get $10 of free credits; indexing
  costs about $0.13 per 1,000 pages.
- Access to the repository. While it is private, you need a GitHub personal access token with read
  access to it (BRAT stores it in Obsidian's secret storage).

## Install

1. In Obsidian, install and enable **BRAT** from Settings → Community plugins → Browse.
2. If the repository is private: Settings → BRAT → GitHub Personal Access Token, and add your token.
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

## Reporting

Use the issue templates: **Bug report** or **Beta feedback**. Include the output of
**Show index status**, never your API key. For bugs, the **Debug log** setting adds details to the
developer console without logging the key.
