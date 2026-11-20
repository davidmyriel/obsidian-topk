# Benchmark

The Stage 3 benchmark (PLAN.md) runs the same queries through several search setups and reports
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

## Still to do

- Handwriting, whiteboard and screenshot files. The papers and slides cover diagrams, charts,
  tables and plain text only. Wikimedia Commons was tried, but it throttles scripts that do not
  identify a contact in their user agent, so those files were left out for now.
- `queries.jsonl`: 50 queries with the correct file and page(s) and a category (diagram, chart,
  table, handwriting, screenshot, plain text), labelled independently by two people.
- Runners for each setup and `npm run bench`.
