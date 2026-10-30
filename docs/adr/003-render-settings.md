# ADR-003: Render settings

- Status: Accepted by Dave on 2026-10-29
- Date: 2026-10-29
- Spike: `docs/spikes/C-rendering.md`

## Context

Pages are rendered with Obsidian's bundled pdf.js (`loadPdfJs()`) and uploaded as images that TopK
embeds (ADR-002). TopK caps an image at 512 KB. Spike C measured 1024, 1536 and 2048 px long sides.
Render time is not a factor (under 40 ms per page everywhere); encoded size is.

## Decision

- **Pixel budget of 1,310,720 px (about 1.3 MP)** by default, amended 2026-10-30 (see below).
  Each page is scaled so width × height fits the budget, whatever its shape: about 1526×858 for a
  16:9 slide, 962×1361 for A4. A "Smaller uploads" option halves the budget.
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

- Measured at the full budget: dense paper pages (US Letter, 1006×1302) average 189 KB, max 223 KB,
  with no quality step-down; slides are 29–49 KB. About 25–30 dense pages fit a 6 MB upsert batch.
- The Node test renderer uses a newer pdf.js than Obsidian (6.4.299 vs 5.3.34). The e2e spike keeps
  Obsidian's own renderer covered; the renderer avoids APIs that differ between the two.
- If `topk-embed-v1` turns out to use a fixed input size, the default should match it.

## Amendment, 2026-10-30: pixel budget instead of a fixed long side

The original decision was a 1024 px long side, the smallest size that kept the hero query at rank 1.
The open topk-embed-v1 models (`docs/spikes/E-topk-embed-v1.md`) cap images at 1,280 visual tokens
of 32×32 px, 1,310,720 pixels, and downscale anything larger. At 1024 px a slide used about 45% of
that budget and an A4 page about 57%, so the model saw less detail than it could; at 1536 px and
above the model throws pixels away. Rendering to the model's pixel budget gives every page shape
full detail with no wasted upload. Approved by Dave on 2026-10-30.

The budget is read from the open small and xsmall models; TopK has not published the production
model's preprocessing. Pages indexed before this change keep their old renders until the file
changes or the index is rebuilt (Stage 2).
