# ADR-006: Hybrid ranking

- Status: Proposed. It needs Dave's approval: it adds a TopK collection after the beta (PLAN.md
  rule 6). A spike must confirm the TopK behaviour marked "verify".
- Date: 2026-11-20

## Context

Visual search ranks pages by `semantic_similarity` against the page image (ADR-002). It is weak on
exact text: a single rare word ("San"), an invoice number ("INV-2291"), a function name or an exact
quote. PLAN.md Stage 4 lists a "hybrid ranking toggle": keyword matches on the page's text layer,
fused with the vector results.

TopK supports keyword search natively (vendored protos, v0.16.1):

- A `text` field can carry a `keyword_index` (`KEYWORD_INDEX_TYPE_TEXT`, or `EXACT` for whole
  values). `ngram_index` exists too.
- `FunctionExpr.bm25_score` (with optional `b` and `k1`) can be selected as a score.
- `FilterStage` accepts a `TextExpr` with terms (`all`, `should`, per-term `weight` and `field`).
- `LogicalExpr` has arithmetic (`add`, `mul`, `min`, `max`), so scores can be combined on the server.
- There is no call to change a collection's schema: `CollectionService` has only list, get, create
  and delete.

### Measured: blending keyword scores hurts descriptive queries

Before designing anything, we simulated fusion offline with the benchmark (`bench/`). We combined the
TopK ranking with the text-layer BM25 ranking (MiniSearch over pdf.js text, the `bm25` setup) for the
same 100 queries. The scores below are Recall@1 / Recall@5 on draft labels, for 50 queries per tier.

| Ranking                                       | Specific   | Vague     | Vague charts |
| --------------------------------------------- | ---------- | --------- | ------------ |
| TopK only (today)                             | 98% / 100% | 48% / 74% | 17% / 42%    |
| Reciprocal rank fusion, equal weights         | 78% / 96%  | 28% / 72% | 8% / 25%     |
| Reciprocal rank fusion, BM25 weighted 0.3     | 86% / 98%  | 38% / 76% | 8% / 42%     |
| Keyword bonus only inside TopK's top 10 (0.1) | 88% / 100% | 38% / 78% | 8% / 42%     |

Every blend moves the right page down. The benchmark's queries describe what a page looks like or
is about, and for those the text layer mostly adds noise: words that appear on many pages. The vague
chart queries were the hoped-for win, and they got worse, because the chart's words are on the
neighbouring slides too.

The simulation is a proxy. MiniSearch uses prefix and fuzzy matching with OR semantics, which is
noisier than a strict server-side match. But it is enough to rule out "always blend".

## Decision

**Keyword matching is a constraint for exact-text queries, not a score blended into every search.**

1. **When it applies.** Visual ranking stays the default for every query. Keyword matching switches
   on only for terms the user marks or that look like identifiers:
    - text in double quotes: `"reciprocal rank fusion"`;
    - tokens with digits or internal punctuation: `INV-2291`, `p99`, `v0.16.1`, `TOI-776`;
    - all-caps tokens of 2–10 letters: `MAPE`, `BTMF`.

    Everything else in the query stays visual. A setting, **Exact text matching** (on by default),
    turns the feature off entirely.

2. **How it ranks.** The visual query runs as today. In parallel, a keyword query asks for this
   vault's pages whose text contains every exact term. The results:
    - Pages that contain all exact terms come first, in visual-score order. With a quoted phrase and
      nothing else to rank by, BM25 order is used instead.
    - The remaining visual results follow, so a wrong guess about intent costs one shifted list, not
      an empty one.
    - If no page contains the terms, the results are purely visual, with a note: "No page contains
      INV-2291; showing the closest pages".
3. **Where the text lives.** A second collection, `<collection>-text`, with one document per page
   under the same `_id` as the image document:

    | Field          | Type           | Index                                                      |
    | -------------- | -------------- | ---------------------------------------------------------- |
    | `vault_id`     | text, required | none                                                       |
    | `content_hash` | text, required | none                                                       |
    | `page`         | integer        | none                                                       |
    | `page_text`    | text           | `keyword_index(TEXT)` (verify how it tokenizes `INV-2291`) |

    It sits beside the image collection, not in it, because a schema can't be changed: adding
    `page_text` to the image collection would mean a new collection and re-uploading every page
    image for every existing user. A separate text collection is filled in the background from the
    pdf.js text layer the renderer already reads, at the cost of write data only, with no
    embeddings. Users who turn the feature off never create it.

4. **Lifecycle.** Everything that touches pages touches both collections:
    - Upserts write the text document after the image document.
    - Deletes and purges (`deleteVault`, orphan cleanup, rebuild, Remove my data, a collection
      change) cover `-text` too.
    - The index state gains a per-hash `textIndexed` flag, so the backfill resumes like any other
      run (ADR-005).
    - Images get no text document. OCR is out of scope.
5. **Privacy.** Page text becomes stored data in TopK, next to the page images it is derived from.
   PRIVACY.md, the first-run dialog and the setting's description must say so. File names and paths
   still never leave the device.

## How we will know it works

Add a third benchmark tier, **exact**: about 20 queries built around a token from the target
page's text (identifiers, acronyms, numbers, quoted phrases, such as `"Tonnetz features"` or
`TOI-776 c planet radius`). Ship the feature on by default only if:

- exact-tier Recall@1 improves clearly over visual-only (by 15 points or more), and
- the specific and vague tiers are unchanged, since none of their queries should trigger it. A
  regression there means the trigger is too eager.

## Consequences

- Searches that trigger it make two TopK queries in parallel. TopK bills queries at $0.50 per
  million, so the cost is negligible, and latency is the slower of the two calls.
- Storage grows by the text of each page, a few KB, small next to the page image.
- Every delete path gains a second call. The fake TopK and the e2e mock need the text collection.
- Existing users get exact matching after the background backfill, with no re-upload of images.
- The trigger rules are heuristics. They are unit-tested and kept in one function, so the
  benchmark can tune them.

## Rejected

- **Blend BM25 into every query** (reciprocal rank fusion or a weighted sum): measured above; it
  lowers Recall@1 on both existing tiers.
- **One collection with `page_image` and `page_text`:** one query instead of two, and atomic
  deletes. But the schema can't be changed, so every existing user would re-upload and re-embed
  every page. Worth reconsidering if TopK adds schema changes, or at a future major version that
  re-indexes anyway.
- **Server-side score arithmetic** (`semantic + w·bm25` in one select): it needs both fields in one
  collection (see above), and the MaxSim and BM25 scales differ per query, so no fixed `w` holds.
- **Client-side keyword index** (MiniSearch in the plugin): no TopK change, but the text index
  would live on each device, re-built per device and kept in plugin data. It splits search across
  two systems for no gain over TopK's own keyword index.

## Spike before building (verify)

1. How `KEYWORD_INDEX_TYPE_TEXT` tokenizes `INV-2291`, `p99`, `v0.16.1` and accented words; whether
   `ngram_index` is the better choice for identifiers.
2. Whether `bm25_score` needs a text filter in the same query, and how `TextTermsExpr.all` and
   `should` combine with the `vault_id` filter.
3. Phrase matching: whether TopK matches a quoted phrase as a phrase, or only as all of its terms.
   If only as terms, check the phrase on the client against the returned page's text.
4. The limits on `page_text` size per document; dense pages run to about 10 KB of text.
