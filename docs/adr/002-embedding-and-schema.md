# ADR-002: Embedding and schema

- Status: Accepted by Dave on 2026-10-29
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

| Field          | Type              | Index              | Notes                                                            |
| -------------- | ----------------- | ------------------ | ---------------------------------------------------------------- |
| `_id`          | string            | —                  | `${vaultId}:${contentHash}:${page}:${tile}` (amended 2026-10-30) |
| `vault_id`     | text, required    | none               | equality filter on every search                                  |
| `content_hash` | text, required    | none               | SHA-256 of the file bytes                                        |
| `page`         | integer, required | none               | 1-based; sent as i64                                             |
| `tile`         | integer, required | none               | 0 unless the image was tiled                                     |
| `kind`         | text, required    | none               | `pdf_page`, `image`, `image_tile`                                |
| `page_image`   | image, required   | `semantic_index()` | JPEG, at most 512 KB                                             |

Scores are `f32` MaxSim sums, not normalised; the UI ranks by them and does not show them as
percentages.

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
- An existing collection's schema cannot be reused unless it has exactly this image field. The
  plugin creates its own collection on first index, and "Test connection" should check the schema
  of an existing one.
- The cost preview's per-page figure is unknown until TopK says how image embedding is billed.

## Rejected

- **Matrix field plus client-side embedding with the hosted model:** no API exists for it.
- **Storing PNG:** larger than JPEG for rendered pages and closer to the 512 KB limit, with no
  expected retrieval gain at these resolutions (Spike C).

## Amendment, 2026-10-30: vault id in the document id

The original id was `${contentHash}:${page}:${tile}`. Because the default collection is shared by
every vault that uses it, two vaults containing the same file wrote the same ids, and the second
upload overwrote the first vault's `vault_id`, hiding those pages from the first vault's searches.
Ids are now `${vaultId}:${contentHash}:${page}:${tile}`. Identical files within one vault are still
stored once.

Local state moved to version 2. A version 1 state keeps its vault id and file hashes, forgets its
uploads and is marked for a purge: the next index deletes every document with this vault's
`vault_id` (a `DeleteDocuments` filter on `vault_id`, confirmed live) and uploads again.
The same vault-filtered delete backs "Remove my data from TopK" and "Rebuild index", so they never
touch other vaults in a shared collection.
