# Spike B: image embedding with topk-embed-v1

Date: 2026-10-29. Sources: TopK protos at v0.16.1 (`vendor/topk-protos`), the SDK docs in the TopK
repo at the same tag, the live pages docs.topk.io/limits and topk.io/pricing (read 2026-10-29).

Status: **request shapes settled from the protos and SDK; live recording still pending** because no
`TOPK_API_KEY` was available in this environment. `npx tsx scripts/smoke.ts --record` records the
real pairs into `tests/fixtures/topk/`, and the contract tests in
`tests/contract/topk-fixtures.test.ts` switch on automatically once those files exist.

## Who embeds: TopK, on upsert

There is no embedding RPC. The complete list of services in the v0.16.1 protos is
`CollectionService`, `WriteService`, `QueryService`, `PartitionService` and the management services;
none takes an image and returns vectors. Instead:

- A collection field of type `image()` with a `semantic_index()` makes TopK embed the image with the
  production topk-embed-v1 model when the document is upserted (docs: collections/manage, "Semantic
  indexes also work on image() fields, so text queries can search JPEG and PNG images").
- A query uses `fn.semanticSimilarity(field, "query text")`. TopK embeds the text with the same model
  and scores with quantized MaxSim (docs: guides/semantic-search).
- `SemanticIndex.model` and `embedding_type` are deprecated in the proto, so the model cannot be chosen
  by the client.

So the plan's `embedding` matrix field with a `multi_vector_index` is not needed, and is not
possible with the hosted model: the plugin never sees the vectors. The matrix path remains for the
Stage 4 "local encoding" option, which would embed on the laptop and upsert a `matrix()`.

## Exact requests

All builders live in `src/topk/requests.ts` and mirror the SDK call in their doc comment.
The endpoint is `https://{region}.api.topk.io`, gRPC over HTTP/2 (ADR-001).

| Step              | RPC                                                  | Extra header        | Body                                |
| ----------------- | ---------------------------------------------------- | ------------------- | ----------------------------------- |
| Create collection | `topk.control.v1.CollectionService/CreateCollection` | —                   | `name`, `schema` map (below)        |
| Upsert pages      | `topk.data.v1.WriteService/UpsertDocuments`          | `x-topk-collection` | `docs[].fields` map of `Value`      |
| Search            | `topk.data.v1.QueryService/Query`                    | `x-topk-collection` | stages: select, filter, sort, limit |
| Delete pages      | `topk.data.v1.WriteService/DeleteDocuments`          | `x-topk-collection` | `ids`                               |
| Delete collection | `topk.control.v1.CollectionService/DeleteCollection` | —                   | `name`                              |

The page image goes in as `Value { image: Image { jpeg: <bytes> } }` (or `png`). The proto allows only
JPEG and PNG, so WebP vault images must be re-encoded before upload. Integers are sent as `i64`, as
topk-js does for JS integers.

The search stages are what `select({...}).filter(field('vault_id').eq(v)).sort(field('score'), false).limit(20)`
produces in topk-js. `topk()` is deprecated in favour of `sort` + `limit`. Read-after-write uses the
upsert's `lsn` as `required_lsn` on the query.

## Limits

| Limit                      | Repo docs at v0.16.1 | docs.topk.io today |
| -------------------------- | -------------------- | ------------------ |
| Max document size          | 200 KB               | 2 MB               |
| Max image size             | not listed           | **512 KB**         |
| Max upsert request         | 8 MB                 | 8 MB               |
| Max multi-vector dimension | not listed           | 1024               |

The live page wins. Consequences: a page image must be at most 512 KB, and one upsert carries about
8 MB, so batches should be capped by bytes (for example 6 MB) rather than by count. Rendered fixture
pages are 15–29 KB as JPEG at 1024 px (Spike C), far below the limit.

## Tokens and price per page: not measurable from the API

- topk.io/pricing lists **"Text embedding — $0.05 per 1M tokens"** ("Built-in multi-vector
  embeddings") and nothing for image embedding. Other relevant lines: write requests $0.01 per 1K,
  write data $0.50 per GiB, storage $0.10 per GiB-month, query requests $0.50 per 1M, egress $0.20
  per GiB. New accounts get $10 of free credits.
- No response carries token counts: `UpsertDocumentsResponse` has only `lsn`, and responses are
  read with no usage headers.
- So the per-page cost for the Stage 2 cost preview needs TopK to say how images are billed. If
  images are billed as text-embedding tokens, the console's Usage page after a recorded run would
  give the number empirically.

A rough upper bound from the data lines alone: 1,000 pages at about 30 KB each is about 0.03 GiB
written ($0.015) plus 1 write request per batch; storage is cents per month. Embedding is the
unknown term.

## Privacy consequence

Because TopK embeds server-side and stores the field, **the page images themselves are stored in
TopK**, not only their embeddings. Image fields are not returned by queries but can be fetched with
`Get`. PLAN.md's privacy table ("Page images: for embedding; Embeddings: stored") must change to say
images are stored, and "Remove my data from TopK" deletes them with the collection.

## What the recording will add

Running `scripts/smoke.ts --record` with a key will confirm, with real bytes:
the create response's echoed schema, that filtering on an unindexed `vault_id` text field works,
the score value type (`f32` or `f64`), whether `required_lsn` waits for the image embedding, latency
per step, and the hero page's rank.
