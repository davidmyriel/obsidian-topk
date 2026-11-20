# Settings and troubleshooting

## What gets indexed

- **Files:** PDF (every page), PNG, JPEG and WebP. Images much taller than they are wide (long
  screenshots) are split into page-sized tiles. Markdown notes are included only with **Search
  notes** on.
- **Defaults:** the whole vault except the Obsidian config folder and `.trash`.
- **Large PDFs:** a PDF with more pages than **Max pages per file** (default 300) is skipped and
  listed in **Show index status**.

## Settings

| Setting             | Default                  | What it does                                                                                                                                                                    |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TopK API key        | none                     | Stored in Obsidian's secret storage. Create one in the TopK console.                                                                                                            |
| Region              | AWS us-east-1            | Where your TopK project stores data. Must match your project.                                                                                                                   |
| Collection          | `obsidian-visual-search` | Created on first index. After a change, the next index uploads the vault to the new collection and deletes this vault's pages from the old one. Notes use `<collection>-notes`. |
| Test connection     |                          | Checks the key, the region and the collection.                                                                                                                                  |
| Index automatically | on                       | Re-indexes a few seconds after files change, and when Obsidian starts.                                                                                                          |
| Search notes        | off                      | Also uploads note text, split at headings, and shows matching notes above the pages. See PRIVACY.md.                                                                            |
| Include folders     | whole vault              | One folder per line.                                                                                                                                                            |
| Exclude patterns    | config folder, `.trash`  | Globs such as `Private/**`. They keep whole files out; they don't remove references to excluded files from included notes.                                                      |
| Max pages per file  | 300                      | Larger PDFs are skipped.                                                                                                                                                        |
| Page image size     | Full detail (1.3 MP)     | The model sees at most about 1.3 MP; "Smaller uploads" halves upload size with some loss on small print.                                                                        |
| Parallel uploads    | 4                        | Upload requests at once (1–8).                                                                                                                                                  |
| Custom endpoint     | none                     | Overrides the region, for a private TopK deployment. Must be https unless on this computer.                                                                                     |
| Debug log           | off                      | Writes details to the developer console. Never logs the API key; does log file names.                                                                                           |

## Costs

- **Pages:** about $0.13 per 1,000 to index (embedding, upload and storage); the plugin shows an
  estimate before the first upload.
- **Notes:** embedding costs about $0.05 per 1,000 notes.
- **Searches:** $0.50 per million.
- **New accounts:** $10 of credits.

## Commands

| Command                  | What it does                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Index vault              | Uploads new and changed files and removes deleted ones. Safe to run any time.      |
| Visual search            | Opens search. Quote phrases or type codes (`INV-2291`) for exact matches.          |
| Show index status        | What's indexed, skipped, failed or indexed in part, with Retry.                    |
| Rebuild index            | Deletes this vault's pages and notes from TopK and uploads everything again.       |
| Remove my data from TopK | Deletes everything this vault uploaded and stops automatic uploads.                |
| Clear local index        | Forgets what this device indexed; the next run replaces this vault's data in TopK. |
| Save results as note     | Writes the last search's notes and pages as links.                                 |

## Troubleshooting

| Symptom                                     | What to do                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "needs a TopK API key"                      | Add the key in settings, then **Test connection**.                                                                                                                             |
| Key rejected, or "not found"                | Check the key and that **Region** matches your TopK project.                                                                                                                   |
| A file is listed as failed                  | Open **Show index status**: the reason is next to it. **Retry failed** tries again after you fix the file. Broken or encrypted PDFs fail on their own and don't stop the rest. |
| A PDF is skipped                            | It has more pages than **Max pages per file**. Raise the limit, or split the PDF.                                                                                              |
| Status bar says "Offline, will resume"      | Indexing waits for the network and continues by itself.                                                                                                                        |
| Search finds nothing after upgrading to 2.0 | The first 2.x index re-uploads every page to `<name>-v2`; search works again when it finishes.                                                                                 |
| One-word searches miss                      | Describe the page in a few words ("old world map", not "map"). One- and two-word searches also match file names.                                                               |
| An exact code isn't found                   | Codes match whole words only: `2291` won't find `INV-2291`.                                                                                                                    |
| A long note is only partly found            | Notes over 200 sections are indexed in part; Show index status lists them.                                                                                                     |
| Search stopped updating                     | Check **Index automatically**, then run **Index vault** once.                                                                                                                  |

For anything else, open an issue with the **Show index status** output (see CONTRIBUTING.md).
