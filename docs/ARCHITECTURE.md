# Architecture

The plugin is a pipeline from vault files into a TopK collection, plus a search path that maps
TopK hits back to local files. TopK never sees file paths: documents are keyed by content hash.

```
Index vault
  vault files ──► planIndex: filter (include/exclude), hash changed files, count pages
              ──► runIndex: render each page (pdf.js) or prepare the image ──► JPEG ≤ 512 KB
              ──► TopKClient.upsertPages (batched)  ──►  TopK embeds the image (topk-embed-v1)
              ──► index-state.json: hash → pages, ids, status; path → hash

Visual search
  query text ──► TopKClient.search (semantic_similarity, filter vault_id, top 20)
             ──► resolveHits: hash → current path, drop deleted files, top 10
             ──► modal: local thumbnail + text-layer snippet ──► open file.pdf#page=N
```

## Modules

| Folder                                              | Role                                                                                                              | Obsidian imports            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `src/topk`                                          | `TopKClient` interface, gRPC client over Node `http2`, generated protobuf codec, request builders, in-memory fake | none                        |
| `src/render`                                        | pdf.js page rendering, image preparation, thumbnails and snippets; pdf.js and canvas are injected                 | none                        |
| `src/indexer`                                       | glob filters, persisted state, the plan/run pipeline, progress text                                               | none                        |
| `src/search`                                        | link builder, hit resolution, the search modal                                                                    | modal only                  |
| `src/util`                                          | hashing, redacting logger, DOM canvas for Obsidian                                                                | `domCanvas` uses `createEl` |
| `src/main.ts`, `src/settings.ts`, `src/indexing.ts` | plugin lifecycle, settings tab, Obsidian adapters for indexing                                                    | yes                         |

The core folders (`topk`, `render`, `indexer`) run in plain Node, which is how the unit,
integration, contract and live tests exercise them. ESLint enforces the boundary.

## Key decisions

- **Transport (ADR-001):** TopK only speaks gRPC over HTTP/2, so the plugin ships its own small
  unary gRPC client on Node's `http2` with a codec generated from TopK's protos.
- **Embedding and schema (ADR-002):** TopK embeds on upsert. Each page is a document with a
  `page_image` image field and a semantic index; search uses `semantic_similarity` filtered by a
  per-vault id. Page images are stored in TopK.
- **Render settings (ADR-003):** long side 1024 px by default, JPEG quality 0.85, stepped down to
  fit TopK's 512 KB image limit, one page at a time.
- **E2E (ADR-004):** WebdriverIO with `wdio-obsidian-service`, minimum and latest Obsidian.

## Index state

`index-state.json` in the plugin folder holds the vault id, the collection, a stamp per path
(hash, size, mtime) and an entry per content hash (kind, page count, TopK ids, status). A file is
re-hashed only when its size or mtime changes, and re-uploaded only when its hash has no
`indexed` entry. State is saved after every file, so a crash loses at most one file's progress.
Changing the collection setting starts the uploads over in the new collection.

## Tests

| Layer       | Where                                                                                                            | Runs                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Unit        | `tests/unit`                                                                                                     | every PR                                   |
| Contract    | `tests/contract` against recorded TopK fixtures in `tests/fixtures/topk`                                         | every PR                                   |
| Integration | `tests/integration`: pipeline on the fixture vault with `FakeTopK`; gRPC client against a local mock TopK server | every PR                                   |
| E2E         | `tests/e2e`: real Obsidian, mock TopK, index → search → open page 3                                              | every PR (Linux), nightly (macOS, Windows) |
| Live        | `tests/live`: real TopK, 20 fixture pages, hero query                                                            | nightly, needs `TOPK_API_KEY`              |
