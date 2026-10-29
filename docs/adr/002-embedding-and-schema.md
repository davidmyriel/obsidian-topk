# ADR-002: Embedding and schema

- Status: Proposed (awaiting Dave's approval; one open question for TopK on image billing)
- Date: 2026-10-29
- Spike: `docs/spikes/B-image-embedding.md`

## Context

PLAN.md proposed that the plugin obtains topk-embed-v1 multi-vectors and stores them in a
`matrix()` field with a MaxSim `multi_vector_index()`. Spike B found that TopK has no embedding
endpoint: the hosted model runs inside TopK, on upsert for fields with a `semantic_index()`, and on
the query text inside `semantic_similarity()`.

## Decision

TopK embeds. The plugin uploads each page as a JPEG and never handles vectors.

Collection schema (one collection per vault by default, see open questions):

| Field          | Type              | Index              | Notes                                                         |
| -------------- | ----------------- | ------------------ | ------------------------------------------------------------- |
| `_id`          | string            | —                  | `${contentHash}:${page}:${tile}`; full SHA-256 hex in Stage 1 |
| `vault_id`     | text, required    | none               | equality filter on every search                               |
| `content_hash` | text, required    | none               | SHA-256 of the file bytes                                     |
| `page`         | integer, required | none               | 1-based; sent as i64                                          |
| `tile`         | integer, required | none               | 0 unless the image was tiled                                  |
| `kind`         | text, required    | none               | `pdf_page`, `image`, `image_tile`                             |
| `page_image`   | image, required   | `semantic_index()` | JPEG, at most 512 KB                                          |

Search: `select(score = semantic_similarity(page_image, q), content_hash, page, tile, kind)`,
`filter(vault_id == v)`, `sort(score desc)`, `limit(20)`; the plugin shows the top 10 that still map
to a file. The optional `text` field with a keyword index stays out until Stage 4's hybrid ranking.

Upload rules: JPEG only (WebP and others are re-encoded), each image at most 512 KB (renderer steps
JPEG quality down, then fails the page), upserts batched to at most 6 MB of request body.

## Consequences

- The `Embedder` interface in PLAN.md disappears; `TopKClient.upsertPages` takes encoded images.
- Page images are stored in TopK. The privacy table, README, first-run dialog and `docs/PRIVACY.md`
  must say so. Deleting the collection removes them.
- Query cost is one `Query` call; no separate query-embedding call.
- Stage 4 "Find similar pages" cannot query with a page's own vectors, which are never exposed. It
  would need TopK support (for example semantic similarity against an image or a document id).
- Stage 4 "Match heatmap" is blocked: no per-token MaxSim scores are returned.
- Stage 4 "Local encoding" would use a separate schema with a `matrix()` field and
  `multi_vector_distance()`; it is not compatible with this collection.
- The cost preview's per-page figure is unknown until TopK says how image embedding is billed.

## Rejected

- **Matrix field plus client-side embedding with the hosted model:** no API exists for it.
- **Storing PNG:** larger than JPEG for rendered pages and closer to the 512 KB limit, with no
  expected retrieval gain at these resolutions (Spike C).
