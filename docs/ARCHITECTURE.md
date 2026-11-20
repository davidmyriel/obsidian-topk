# Architecture

The plugin is a pipeline from vault files into TopK, plus a search path that maps TopK hits back
to local files. Documents are keyed by content hash, so file paths are not sent as separate data;
text inside an uploaded page or note goes with it (see PRIVACY.md).

```
Index vault (pages, then notes if Search notes is on)
  vault files ──► planIndex: filter (include/exclude), hash changed files, count pages and tiles
              ──► runIndex: render each page (pdf.js) or redraw the image ──► JPEG ≤ 512 KB
                            + the page's text layer (accent-folded, ≤ 100,000 characters)
              ──► TopKClient.upsertPages ──► <collection>: page_image (semantic index)
                                                        + page_text (keyword index)
              ──► index-state.json: hash → pages, ids, status; path → hash
  notes (.md) ──► runNoteIndex: hash, split at headings ──► <collection>-notes:
                            note_text (semantic index) + note_keywords (keyword index)
              ──► notes-state.json: hash → section ids and headings; path → hash

Search
  query text ──► searchVault: visual query (semantic_similarity on page_image), and for quoted
                 phrases or codes the one-query hybrid (match on page_text + BM25), in parallel
             ──► searchNotes (if notes are indexed): best section per note, close to the top score
             ──► modal: Notes section, then pages with local thumbnails ──► open page or heading
```

## Modules

| Folder                                                                      | Role                                                                                                              | Obsidian imports            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `src/topk`                                                                  | `TopKClient` interface, gRPC client over Node `http2`, generated protobuf codec, request builders, in-memory fake | none                        |
| `src/render`                                                                | pdf.js page rendering, image preparation, thumbnails and snippets; pdf.js and canvas are injected                 | none                        |
| `src/indexer`                                                               | glob filters, persisted state, the plan/run pipeline, progress text                                               | none                        |
| `src/notes`                                                                 | note splitting at headings, notes state and the notes indexer (ADR-007)                                           | none                        |
| `src/search`                                                                | exact-term parsing, page and notes search, name matching, links, the search modal                                 | modal only                  |
| `src/util`                                                                  | hashing, redacting logger, DOM canvas for Obsidian                                                                | `domCanvas` uses `createEl` |
| `src/main.ts`, `src/settings.ts`, `src/indexing.ts`, `src/notesIndexing.ts` | plugin lifecycle, settings tab, Obsidian adapters for page and notes indexing                                     | yes                         |

The core folders (`topk`, `render`, `indexer`, `notes`) run in plain Node, which is how the unit,
integration, contract and live tests exercise them. ESLint enforces the boundary.

## Key decisions

- **Transport (ADR-001):** TopK only speaks gRPC over HTTP/2, so the plugin ships its own small
  unary gRPC client on Node's `http2` with a codec generated from TopK's protos.
- **Embedding and schema (ADR-002):** TopK embeds on upsert. Each page is a document with a
  `page_image` image field and a semantic index; search uses `semantic_similarity` filtered by a
  per-vault id. Page images are stored in TopK.
- **Render settings (ADR-003):** each page is scaled to the model's pixel budget (about 1.3 MP),
  JPEG quality 0.85, stepped down to fit TopK's 512 KB image limit, one page at a time.
- **Live updates and resume (ADR-005):** vault changes trigger a debounced incremental index; an
  interrupted file resumes after its last uploaded page.
- **E2E (ADR-004):** WebdriverIO with `wdio-obsidian-service`, minimum and latest Obsidian.
- **Hybrid ranking (ADR-006):** each PDF page's text is stored next to its image with a keyword
  index. Quoted phrases and letter-and-digit codes run TopK's one-query hybrid; other queries stay
  visual. Collections from 1.x lack the text field, so the first 2.x run moves to `<name>-v2`.
- **Notes search (ADR-007):** opt-in. Notes go to `<collection>-notes`, split at headings, and are
  shown in their own section because text and image scores are not comparable.

## Index state

`index-state.json` in the plugin folder holds the vault id, the collection, a stamp per path
(hash, size, mtime) and an entry per content hash (kind, page count, TopK ids, status). A file is
re-hashed only when its size or mtime changes, and re-uploaded only when its hash has no
`indexed` entry. State is saved after every file, so a crash loses at most one file's progress.
Changing the collection setting starts the uploads over in the new collection and deletes this
vault's pages from the old one. `notes-state.json` works the same way for notes.

## Tests

| Layer       | Where                                                                                                            | Runs                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Unit        | `tests/unit`                                                                                                     | every PR                                   |
| Contract    | `tests/contract` against recorded TopK fixtures in `tests/fixtures/topk`                                         | every PR                                   |
| Integration | `tests/integration`: pipeline on the fixture vault with `FakeTopK`; gRPC client against a local mock TopK server | every PR                                   |
| E2E         | `tests/e2e`: real Obsidian, mock TopK, index → search → open page 3                                              | every PR (Linux), nightly (macOS, Windows) |
| Live        | `tests/live`: real TopK, 20 fixture pages, hero query                                                            | nightly, needs `TOPK_API_KEY`              |
