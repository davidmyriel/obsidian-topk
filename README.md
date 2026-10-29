# TopK Visual Search for Obsidian

Find the exact PDF page or image in your vault by describing what it looks like.
Type "slide with the reranker architecture diagram" and get `talk.pdf`, page 15, with a thumbnail.
Click it and Obsidian opens that page.

The plugin uses [TopK](https://topk.io)'s hosted multimodal embeddings (topk-embed-v1), which read
each page as an image, so charts, diagrams, tables, screenshots and scans are searchable without
OCR.

> Desktop only. Requires a TopK account and API key. TopK is a paid service; new accounts get free
> credits.

## Use

1. Install the plugin (see below) and open **Settings → TopK Visual Search**.
2. Add your TopK API key (stored in Obsidian's secret storage), pick your region, and click
   **Test connection**.
3. Run **Index vault** from the command palette. The first time, the plugin shows how many pages it
   will upload and waits for you to confirm. Progress shows in the status bar, with a Cancel link.
4. Run **Visual search** (or click the ribbon icon), describe the page, and press Enter. Click a
   result to open the PDF at that page.
5. **Save results as note** writes the results as `[[file.pdf#page=N]]` links.

Running **Index vault** again only uploads files whose content changed. Renaming or moving files
costs nothing, because pages are identified by a hash of the file content.

Indexed file types: PDF, PNG, JPEG and WebP.

## Network use and privacy

The plugin connects only to the TopK endpoint for your region. It uploads an image of each page,
which TopK stores in your collection so it can be searched, and the text of your queries. File names
and folder paths never leave your device. There is no telemetry. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Install for testing

Until the plugin is in the community store:

```bash
npm ci
npm run build
```

Then copy `main.js`, `manifest.json` and `styles.css` into
`<your vault>/.obsidian/plugins/topk-visual-search/` and enable the plugin under
**Settings → Community plugins**.

## Develop

| Command                    | What it does                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`              | Rebuilds `main.js` on change                                                     |
| `npm run check`            | Lint, typecheck, unit, integration and contract tests, build                     |
| `npm run test:e2e`         | Boots real Obsidian (minimum and latest) with the fixture vault and a mock TopK  |
| `npm run test:live`        | Indexes the fixture vault into a throwaway TopK collection; needs `TOPK_API_KEY` |
| `npx tsx scripts/smoke.ts` | Stage 0 smoke test against live TopK                                             |

Design notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the decisions in
[docs/adr](docs/adr).
