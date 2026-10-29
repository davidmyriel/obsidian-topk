# Spike C: page rendering

Date: 2026-10-29. Machine: Apple Silicon Mac (darwin-arm64), Node 24.18.0.

## Setup

`src/render/pdfRenderer.ts` renders one page at a time with an injected pdf.js and canvas, encodes
JPEG at quality 0.85, and steps quality down (0.75, 0.65, 0.5) only if a page exceeds TopK's 512 KB
image limit. Each canvas is released (`width = height = 0`) and each page cleaned up before the next.

- **Obsidian:** `loadPdfJs()` from the `obsidian` module plus DOM canvases (`src/util/domCanvas.ts`,
  `canvas.toBlob('image/jpeg')`). Run inside real Obsidian by `tests/e2e/spikes.e2e.ts`
  (`E2E_SPIKES=1 npm run test:e2e`). Obsidian 1.14.5 and 1.11.4 both bundle **pdf.js 5.3.34**.
- **Node:** `pdfjs-dist` 6.4.299 with `@napi-rs/canvas` (`tests/support/node-render.ts`), by
  `scripts/spike-c-render.ts <file> <longSide>`, one process per run.

Documents: the fixture `Talks/talk.pdf` (3 slides, 960×540 pt) and, locally only, a 16-page arXiv
paper (`layout-parser-paper.pdf`, US Letter) for denser pages. The paper is not committed.

## Results inside Obsidian 1.14.5 (fixture talk, per page)

| Long side | Render ms | Encode ms           | JPEG KB (p1 / p2 / p3) | Peak RSS over base |
| --------- | --------- | ------------------- | ---------------------- | ------------------ |
| 1024      | 6–14      | 4–100 (one outlier) | 19 / 15 / 29           | +26 MB             |
| 1536      | 5–18      | 6–12                | 31 / 24 / 51           | +22 MB             |
| 2048      | 3–16      | 10–20               | 47 / 38 / 75           | +35 MB             |

Obsidian 1.11.4 gave the same sizes and similar times. Renderer RSS was 175–250 MB before rendering,
so a page adds tens of MB at most and is released between pages.

## Results in Node (pdfjs-dist 6.4.299)

| Document        | Long side | ms per page (render + encode) | JPEG KB avg / max |
| --------------- | --------- | ----------------------------- | ----------------- |
| talk.pdf        | 1024      | 53 (first-page warm-up)       | 20 / 28           |
| talk.pdf        | 1536      | 26                            | 35 / 50           |
| talk.pdf        | 2048      | 29                            | 53 / 74           |
| paper, 16 pages | 1024      | 27                            | 128 / 152         |
| paper, 16 pages | 1536      | 30                            | 246 / 291         |
| paper, 16 pages | 2048      | 35                            | 374 / 444         |

Peak RSS in Node was 490–740 MB, dominated by the tsx/pdf.js baseline of about 255 MB plus native
canvas buffers; it did not grow with page count.

## Findings

1. Rendering cost is negligible at all three sizes: under 40 ms per page, so 1,000 pages render in
   well under a minute. Upload and embedding time will dominate indexing.
2. **Size is the binding constraint.** Dense text pages at 2048 px reach 444 KB as JPEG, close to the
   512 KB limit, and scans or photos would go over and trigger quality step-down. 1536 px keeps
   dense pages near 250–290 KB.
3. Memory is flat across pages, so the one-page-at-a-time design holds; the 1,000-page PDF test
   belongs in Stage 2's load test.
4. Obsidian's pdf.js (5.3.34) and the Node test copy (6.4.299) differ. Our renderer only uses
   `getDocument`, `getPage`, `getViewport`, `render` and `cleanup`, which both support, and the
   loading task's `destroy()` (PDFDocumentProxy.destroy no longer exists in pdfjs-dist 6).
5. In Node, pdf.js needs `standardFontDataUrl` to render the standard 14 fonts; Obsidian handles this
   itself.

## Retrieval quality per resolution (live, 2026-10-29)

`scripts/smoke.ts --long-side N`, hero query "slide with the reranker architecture diagram":

| Long side | Page 3 (hero) | Page 1 | Page 2 | Hero at rank 1 |
| --------- | ------------- | ------ | ------ | -------------- |
| 1024      | 5.23          | 2.94   | 2.70   | yes            |
| 1536      | 5.36          | 3.09   | 2.97   | yes            |
| 2048      | 5.42          | 3.35   | 3.06   | yes            |

All three pass with nearly the same margin (about 2.1–2.3 points), so on the fixture, resolution
barely matters. The fixture slides are simple, though, and dense pages (small table text, scans) are
where resolution should matter. That needs the Stage 3 benchmark corpus.
