# ADR-005: Live updates and resume

- Status: Accepted (Stage 2, under the "merge when green" agreement of 2026-10-30)
- Date: 2026-10-30

## Context

PLAN.md Stage 2 asks for live updates (create, modify, rename, delete with a 5-second debounce)
and a "durable queue" so closing Obsidian mid-index resumes where it stopped.

## Decision

**Reconcile, don't queue.** Vault events do not become jobs in a persisted queue. Every relevant
event (a supported file, or any folder, since moving a folder moves its files) asks a scheduler for
a run; the run starts after 5 seconds without further changes and is an ordinary incremental
**Index vault**: re-hash only files whose size or mtime changed, upload content not yet in TopK,
delete pages of content that is gone.

- Changes during a run schedule exactly one more run after it; runs never overlap.
- A reconcile also runs shortly after Obsidian starts. That catches edits made while Obsidian was
  closed (which no event queue would see) and finishes an interrupted run.
- **Resume at page level:** the state already records, per content hash, the ids of pages that
  landed. A `partial` file restarts after them; pdf.js skips those pages without rendering.
- Background runs are quiet: skipped when auto-indexing is off, before the first-upload consent,
  or with no key; the status bar appears only once uploads start; notices only for failures.
- Setting **Index automatically**, on by default.

## Consequences

- The "queue" is the index state itself, saved after every file and every landed batch, so there
  is one source of truth instead of a queue that can disagree with it.
- A reconcile costs one directory listing and a stat compare per file; hashing and rendering only
  happen for changed files. Vaults with tens of thousands of files are covered by the Stage 2 load
  test.
- Renames are free (same content hash); a modified file deletes its old pages and uploads new ones
  in the same run.

## Rejected

- **Persisted event queue:** misses changes made while Obsidian is closed, needs de-duplication
  (create then delete, rename chains), and can drift from the index state.
