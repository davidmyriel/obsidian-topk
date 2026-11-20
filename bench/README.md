# Benchmark

The Stage 3 benchmark (docs/PLAN.md) runs the same queries through several search setups and reports
page-level accuracy. This folder holds the corpus manifest and the scripts.

## Corpus

`corpus.json` lists 35 openly licensed files, 1,026 pages, gathered from public sources:

| Type   | Files | Pages | Source                                                 | Licence   |
| ------ | ----: | ----: | ------------------------------------------------------ | --------- |
| paper  |    23 |   428 | arXiv papers from many fields, with figures and tables | CC BY 4.0 |
| slides |    12 |   598 | Zenodo presentation decks                              | CC BY 4.0 |

Each entry records its source page, author, licence, SHA-256 and page count. The files themselves
are not committed. Fetch them with:

```bash
npm run bench:fetch
```

This downloads into `bench/corpus/` (git-ignored), skips files that are already present and
intact, and fails if any file's SHA-256 differs from the manifest. Adding an entry: put it in
`corpus.json` without `sha256`, `bytes` or `pages`, then run `npm run bench:fetch -- --record`.

**Attribution.** Reuse of any file follows its own licence, as recorded in `corpus.json`. Reports
and screenshots that show a page must credit its author and licence.

## Queries

`queries.jsonl` has 50 targets: 12 diagram, 12 chart, 10 table, 6 screenshot and 10 plain text
(the control). They point at 25 of the 35 files, and the rest act as distractors. Each target has
two queries:

- **specific** (`q01`–`q50`): written while looking at the page, naming its distinctive details.
  Both setups find these easily, so they show little headroom.
- **vague** (`v01`–`v50`, with `of` naming the specific twin): a half-remembered description of
  3–8 words, with no colours, numbers or names. These are the harder and more realistic tier.
  Several pages can fit a vague query; for now only the original page counts.

- **exact** (`e01`–`e25`): built around an identifier, code or quoted phrase that appears in the
  text of the target page only (ADR-006). One phrase exists only inside a screenshot.

- **near-duplicate** (`n01`–`n10`): 20 generated invoices with one layout (`bench/invoices.ts`,
  built by `bench:fetch`), told apart only by number, customer, dates and amounts.

Each line holds the query, its tier and category, and a drafted answer (`file`, 1-based `pages`)
with `status: "draft"`.

The drafts were written by Claude from rendered pages and checked against look-alike pages in the
same files. docs/PLAN.md asks for two people to label every query independently, so the drafts are not
ground truth yet:

1. `npm run bench:labels -- sheet` writes `labels/sheet.md`, the queries without answers.
2. Each labeller finds the page for each query and saves `labels/<initials>.json`, as
   `{ "q01": { "file": "papers/….pdf", "pages": [13] }, … }`, or `null` when no page matches.
3. `npm run bench:labels -- compare AB CD` writes `labels/comparison.md` with every query where
   the two labellers disagree, next to the draft.
4. Resolve those disagreements, set the agreed `answers` in `queries.jsonl` and change `status` to
   `"labelled"`.

## Running

```bash
npm run bench:fetch
```

```bash
npm run bench
```

`npm run bench` runs every query through each setup and writes `bench/report/report.md`,
`results.json` and `recall.svg`. Pick setups with `npm run bench -- --setup bm25,topk,gemini-1p,gemini-6p`.

| Setup       | What it reproduces                                                                    | Needs            |
| ----------- | ------------------------------------------------------------------------------------- | ---------------- |
| `bm25`      | Omnisearch with Text Extractor: the pdf.js text layer per page, ranked by MiniSearch  | nothing          |
| `topk`      | This plugin: its own indexing code and search, topk-embed-v1, one entry per page      | `TOPK_API_KEY`   |
| `gemini-1p` | LLM Hub at its best setting: Gemini Embedding 2 over 1-page PDF chunks, cosine search | `GEMINI_API_KEY` |
| `gemini-6p` | LLM Hub's default: Gemini Embedding 2 over 6-page PDF chunks                          | `GEMINI_API_KEY` |

The TopK setup reads `TOPK_API_KEY` (and optional `TOPK_REGION`, `TOPK_BENCH_COLLECTION`) from
the environment or a git-ignored `.env` at the repo root. It indexes into the collection
`bench-visual-search` under the vault id `bench`, which costs about $0.08 the first time. It keeps
its index state in `bench/report/`, so reruns only search.

The Gemini setups cut each PDF into 1- or 6-page PDFs with pdf-lib, embed them with
`gemini-embedding-2` (`RETRIEVAL_DOCUMENT`), embed queries as text (`RETRIEVAL_QUERY`) and rank by
cosine similarity. Embeddings are cached in `bench/report/`. The 6-page setup is scored leniently:
a chunk is one result, and it counts as the right page when it contains it.

Page-level scoring: a result counts when it names the labelled file and page. Recall@k is 1 if the
page is in the top k, and nDCG@10 and MRR use binary relevance.

## Still to do

- Handwriting, whiteboard and photo files. The papers and slides cover diagrams, charts, tables
  and plain text, plus screenshots inside slides. Wikimedia Commons was tried, but it throttles
  scripts that do not name a contact in their user agent, so those files were left out for now.
- Two independent labels per query (see above).
