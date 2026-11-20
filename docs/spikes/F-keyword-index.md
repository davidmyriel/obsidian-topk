# Spike F: TopK keyword index for exact text matching

Date: 2026-11-20. Script: `scripts/spike-f-keyword.ts` (live TopK, aws-us-east-1-elastica; it
creates and deletes a throwaway collection). Answers the "verify" list in ADR-006.

## Setup

- **Collection:** `vault_id` (text) and `page_text` (text, `keyword_index(TEXT)`).
- **Documents:** 10 documents, including one in another vault and texts of 10 KB and 100 KB.
- **Each query:** `select(score = bm25_score())`, then a `vault_id == v1` filter, a `TextExpr`
  terms filter on `page_text`, `sort(score desc)` and `limit(10)`.

## Results

| Query terms                     | Matched                                 | Meaning                                                           |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `INV-2291`                      | the INV-2291 invoice only               | an identifier with a hyphen is one token                          |
| `inv-2291`                      | the same                                | matching ignores case                                             |
| `INV`, `2291`, or both          | nothing                                 | parts of an identifier don't match                                |
| `INV-2291` (other vault has it) | only vault v1                           | the vault filter and the text filter combine as AND               |
| `p99`                           | the p99 page                            |                                                                   |
| `v0.16.1`                       | the version page                        | dots inside a token are kept                                      |
| `0.16`                          | nothing                                 | no partial matches                                                |
| `pageSource.ts`, `resolveHits`  | the code page, also in lower case       | file names and camelCase work as whole tokens                     |
| `reciprocal rank fusion`        | both the phrase and a shuffled sentence | a multi-word term is split into words; order isn't checked        |
| `brûlée`                        | the page                                |                                                                   |
| `brulee`                        | nothing                                 | accents are not folded                                            |
| `needle100k` in a 100 KB text   | found (BM25 0.43)                       | 100 KB of text per document is accepted                           |
| no text filter                  | error                                   | "Query must have at least one text filter to compute bm25 scores" |

Trailing punctuation in the text ("INV-2291,") does not stop a match.

## What this means for ADR-006

- **Identifiers work as designed.** The trigger's tokens (`INV-2291`, `p99`, `v0.16.1`,
  `pageSource.ts`) match only when written whole, which is what an exact-text search wants. Partial
  codes (`2291`) don't match; that's acceptable, and the setting description should say so.
- **Phrases need a client check.** TopK returns every page with all the words, so the plugin
  fetches `page_text` for the keyword hits and keeps only pages where the phrase appears in order,
  comparing case-insensitively with whitespace collapsed.
- **Accents:** to match what people type, the plugin folds accents on both sides. It stores the
  text accent-folded (NFKD, combining marks removed) and folds query terms the same way. The
  original text is not needed in TopK.
- **BM25 always comes with a text filter.** This holds by design, since keyword queries only run
  for exact terms.
- **Size:** 100 KB per document was accepted. Text-layer pages are rarely above 20 KB. Cap
  `page_text` at 100 KB and record the cut in the index state.
- **`ngram_index`:** not needed for the trigger cases; partial matching is not a goal.
