# ADR-007: Notes search

- Status: Accepted (Dave asked for notes search on 2026-11-20).
- Date: 2026-11-20

## Context

The plugin searches PDF pages and images. Markdown notes, the bulk of most vaults, are not indexed.
TopK can embed text with a `semantic_index()` and match words with a `keyword_index()`, so one
search box can cover notes and pages. Notes are also the most private part of a vault, so this must
be a deliberate choice by the user.

## Decision

1. **Opt-in.** A setting, **Search notes**, is off by default. Turning it on opens a dialog that says
   how many notes will be uploaded, that their text is stored in TopK, and that file names and paths
   stay on the device. **Include folders** and **Exclude patterns** apply to notes as they do to
   files.
2. **A separate collection, `<collection>-notes`.** The page collection requires `page_image`, and
   schemas can't be changed (ADR-006), so notes get their own:

    | Field           | Type              | Index                      |
    | --------------- | ----------------- | -------------------------- |
    | `vault_id`      | text, required    | none                       |
    | `content_hash`  | text, required    | none (SHA-256 of the note) |
    | `chunk`         | integer, required | none                       |
    | `note_text`     | text, required    | `semantic_index()`         |
    | `note_keywords` | text, required    | `keyword_index(TEXT)`      |

    `note_keywords` is the same text, accent-folded, because a field has one index and TopK does
    not fold accents (Spike F). Document id: `${vaultId}:${contentHash}:${chunk}`. No path or
    title is sent; a heading is part of its section's text.

3. **Chunks are sections.** Frontmatter is dropped. A note is split at headings. A section of more
   than 2,000 characters is split at paragraph breaks, sections under 200 characters join the next
   one, and a note has at most 200 chunks. Each chunk's heading is kept locally, so a result opens
   the note at that heading.
4. **Its own index state,** `notes-state.json`, shaped like the page state: path → hash locally,
   hash → chunk ids and headings. Renames are free and identical notes are stored once. A changed
   note deletes its old chunks. Vault events for `.md` files schedule a run when the setting is on.
   The run indexes pages first, then notes.
5. **Search.** When notes are indexed, every search also queries the notes collection:
   `semantic_similarity(note_text, q)`. For exact parts (ADR-006: quotes and letter+digit codes) it
   uses TopK's one-query hybrid, a `match` filter on `note_keywords` with BM25 added to the score.
   Notes appear in their own **Notes** section above the pages (top 5), keeping only notes that score
   at least 70% of the best note's score (exact matches always stay): semantic search always
   returns its top k, however weak. MaxSim scores on page
   images and similarity scores on note text are not comparable, so the lists are not merged.
6. **Maintenance.** Rebuild index, Remove my data from TopK and Clear local index cover notes too.
   Turning the setting off deletes this vault's notes from TopK.

## Consequences

- Text embedding is cheap: TopK lists $0.05 per million tokens, so a 1,000-note vault (about 1M
  tokens) costs about $0.05 to index.
- Note text is stored in TopK. PRIVACY.md, the README and the dialog say so.
- A note's edit re-uploads all its chunks (whole-note hash). This is simple, and notes are small.
- The benchmark does not measure notes yet. A note tier needs a note corpus.

## Rejected

- **Merge notes and pages in one ranked list:** the scores live on different scales.
- **Notes in the page collection:** `page_image` is required there, and changing that means another
  re-upload of every page.
- **Chunk by a fixed number of characters:** splits mid-thought; headings are how people structure
  notes and how a result can open in the right place.
