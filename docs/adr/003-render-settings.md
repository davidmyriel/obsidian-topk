# ADR-003: Render settings

- Status: Proposed (awaiting Dave's approval)
- Date: 2026-10-29
- Spike: `docs/spikes/C-rendering.md`

## Context

Pages are rendered with Obsidian's bundled pdf.js (`loadPdfJs()`) and uploaded as images that TopK
embeds (ADR-002). TopK caps an image at 512 KB. Spike C measured 1024, 1536 and 2048 px long sides.
Render time is not a factor (under 40 ms per page everywhere); encoded size is.

## Decision

- **Long side 1024 px** by default, scale computed per page from its viewport at scale 1. PLAN.md's
  rule is "the smallest size that keeps the hero query at rank 1", and all three sizes passed live
  with the same margin (Spike C). 1024 px also keeps dense pages near 130–150 KB, the most headroom
  under 512 KB. The resolution is a setting so Stage 3 can re-check 1536 px on dense pages; switch
  the default if the benchmark's Recall@1 on table and handwriting queries is better at 1536 px.
- **JPEG, quality 0.85**, stepping down to 0.75, 0.65, 0.5 if a page exceeds 512 KB; a page still
  over the limit is skipped and reported, not uploaded.
- White background painted before rendering, so transparent pages do not encode as black.
- One page at a time: render, encode, release the canvas, `page.cleanup()`, then the next page; the
  loading task is destroyed at the end.
- pdf.js and the canvas are injected, so `src/render` has no Obsidian dependency. In Obsidian the
  canvas comes from `src/util/domCanvas.ts`; in tests from `@napi-rs/canvas` with `pdfjs-dist`.
- Images that are already JPEG or PNG and under the limit at their size go up unchanged; others are
  scaled to the same long side and re-encoded (Stage 1 `imagePrep`).

## Consequences

- Dense pages stay around 130–150 KB, leaving headroom under 512 KB and about 40 pages per 6 MB
  upsert batch.
- The Node test renderer uses a newer pdf.js than Obsidian (6.4.299 vs 5.3.34). The e2e spike keeps
  Obsidian's own renderer covered; the renderer avoids APIs that differ between the two.
- If `topk-embed-v1` turns out to use a fixed input size, the default should match it.
