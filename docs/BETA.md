# Installing with BRAT

Until TopK Visual Search is in Obsidian's community plugin store, it installs through
[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tool), which
installs plugins straight from GitHub releases and keeps them up to date. The repository is public,
so no GitHub token is needed.

## Before you start

- Obsidian 1.11.4 or later, on desktop (macOS, Windows or Linux).
- A TopK account and API key from the TopK console. New accounts get $10 of free credits; indexing
  costs about $0.13 per 1,000 pages.

## Install

1. In Obsidian, install and enable **BRAT** from Settings → Community plugins → Browse.
2. Command palette → **BRAT: Add a beta plugin for testing**.
3. Repository: `davidmyriel/obsidian-topk`. Choose the latest version and confirm.
4. Enable **TopK Visual Search** under Settings → Community plugins.

BRAT checks for new releases on startup and updates the plugin.

If you tested a beta with a GitHub token while the repository was private, you can now remove that
token from BRAT and revoke it on GitHub.

## First run

1. Settings → **TopK Visual Search**: add your API key (stored in Obsidian's secret storage), pick
   your TopK region, click **Test connection**.
2. Command palette → **TopK Visual Search: Index vault**. Read the dialog (pages, what is sent,
   estimated cost) and click **Start indexing**.
3. Command palette → **TopK Visual Search: Visual search**, describe a page, press Enter.

After that, the index updates itself when files change. See the README for all commands and
[PRIVACY.md](PRIVACY.md) for what leaves your device.

To stop using it, run **Remove my data from TopK** before you uninstall the plugin. The vault id it
needs lives in the plugin folder, which uninstalling deletes.

## Reporting

Use the issue templates: **Bug report** or **Beta feedback**. Include the output of
**Show index status**, never your API key. For bugs, the **Debug log** setting adds details to the
developer console without logging the key.
