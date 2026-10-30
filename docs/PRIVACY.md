# Privacy

TopK Visual Search sends some of your vault to TopK, a hosted search service, so you can search
pages by what they look like. This page says exactly what leaves your computer.

## What is sent to TopK

| What                                   | Sent?               | Details                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images of PDF pages and of image files | **Yes, and stored** | Each page or image is redrawn and uploaded as a JPEG of at most 512 KB, so metadata inside image files (such as a photo's location, camera or timestamps) is not sent. TopK computes its search embedding from the image and keeps both the image and the embedding in your TopK collection. |
| Your search queries                    | Yes                 | The query text is sent to TopK, which embeds it to rank pages.                                                                                                                                                                                                                               |
| File names and folder paths            | **No**              | Pages are identified by a hash of the file's content plus the page number. The mapping from hash to path stays in the plugin's local data.                                                                                                                                                   |
| PDF text                               | No                  | Result snippets are read from the PDF on your computer.                                                                                                                                                                                                                                      |
| Your TopK API key                      | Only to TopK        | It is sent as the authorization header to the TopK endpoint you chose, kept in Obsidian's secret storage, and never logged.                                                                                                                                                                  |
| Usage analytics                        | No                  | The plugin has no telemetry.                                                                                                                                                                                                                                                                 |

## Before anything is uploaded

The first time you index, the plugin shows how many files and pages it found and what will be sent.
Nothing is uploaded until you choose **Start indexing**.

Files under `.obsidian/` and `.trash/` are never indexed. Add your own exclude patterns in settings,
for example `Private/**`.

## Where it goes

The plugin talks only to `https://<region>.api.topk.io` for the region you pick in settings, or to a
custom endpoint if you set one. Your data lives in your own TopK project and collection.

## Removing your data

- **Remove my data from TopK** deletes every page image and embedding this vault uploaded. Other
  vaults that share the collection are not affected.
- Deleting or excluding a file removes its pages from TopK the next time the vault is indexed.
- **Clear local index** forgets what was indexed on this device; the next index replaces this
  vault's pages in TopK.
- Deleting the collection in the TopK console removes everything in it, from every vault.
