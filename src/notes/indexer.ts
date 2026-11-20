import { compileFilter, type PathFilter } from '../indexer/globs';
import type { FileStamp } from '../indexer/state';
import { foldAccents } from '../search/exact';
import { noteId, type NoteDoc, type NotesClient } from '../topk/notes';
import { sha256Hex } from '../util/hash';
import { chunkNote } from './chunk';

// Notes index (ADR-007): like the page index, keyed by content hash so renames are free. Runs
// without Obsidian; the plugin supplies the reader.

export const NOTES_STATE_VERSION = 1;

export interface NoteEntry {
	/** Heading of each chunk, so a result opens the note at its section. */
	headings: string[];
	ids: string[];
	status: 'indexed' | 'failed';
	reason?: string;
	/** The note had more than MAX_CHUNKS sections; only the first ones are searchable. */
	truncated?: boolean;
	updatedAt: number;
}

export interface NotesState {
	version: number;
	/** The page index's vault id, so one "Remove my data" covers both. */
	vaultId: string;
	/** Notes collection the entries were uploaded to. */
	collection: string;
	files: Record<string, FileStamp>;
	notes: Record<string, NoteEntry>;
	lastLsn?: string;
	needsPurge?: boolean;
	/** Notes collections this vault used before the collection changed; purged by the plugin. */
	staleCollections?: string[];
}

export function emptyNotesState(vaultId: string, collection: string): NotesState {
	return { version: NOTES_STATE_VERSION, vaultId, collection, files: {}, notes: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates persisted JSON. Anything unreadable starts fresh. A different vault id or collection
 * keeps the file hashes, forgets the uploads, and marks the old collection for cleanup.
 */
export function parseNotesState(raw: unknown, vaultId: string, collection: string): NotesState {
	const state = emptyNotesState(vaultId, collection);
	if (!isRecord(raw) || raw.version !== NOTES_STATE_VERSION) return state;
	if (isRecord(raw.files)) {
		for (const [path, v] of Object.entries(raw.files)) {
			if (
				isRecord(v) &&
				typeof v.hash === 'string' &&
				typeof v.size === 'number' &&
				typeof v.mtime === 'number'
			) {
				state.files[path] = { hash: v.hash, size: v.size, mtime: v.mtime };
			}
		}
	}
	const stale = new Set(
		Array.isArray(raw.staleCollections)
			? raw.staleCollections.filter((c): c is string => typeof c === 'string' && !!c)
			: [],
	);
	if (raw.vaultId !== vaultId || raw.collection !== collection) {
		if (typeof raw.collection === 'string' && raw.collection) stale.add(raw.collection);
		state.needsPurge = true;
	} else {
		if (isRecord(raw.notes)) {
			for (const [hash, v] of Object.entries(raw.notes)) {
				if (
					isRecord(v) &&
					Array.isArray(v.ids) &&
					Array.isArray(v.headings) &&
					(v.status === 'indexed' || v.status === 'failed')
				) {
					state.notes[hash] = {
						headings: v.headings.filter((h): h is string => typeof h === 'string'),
						ids: v.ids.filter((id): id is string => typeof id === 'string'),
						status: v.status,
						...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
						...(v.truncated === true ? { truncated: true } : {}),
						updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
					};
				}
			}
		}
		if (typeof raw.lastLsn === 'string') state.lastLsn = raw.lastLsn;
		if (raw.needsPurge === true) state.needsPurge = true;
	}
	stale.delete(collection);
	if (stale.size > 0) state.staleCollections = [...stale].sort();
	return state;
}

export interface NoteFile {
	path: string;
	size: number;
	mtime: number;
}

export interface NotesReader {
	/** Markdown files in the vault. */
	list(): NoteFile[];
	read(path: string): Promise<string>;
}

export interface NotesSummary {
	notesIndexed: number;
	chunksUploaded: number;
	chunksDeleted: number;
	unchanged: number;
	failed: { path: string; reason: string }[];
	/** Notes with more than MAX_CHUNKS sections, indexed only in part (audit A06). */
	truncated: string[];
	cancelled: boolean;
}

const encoder = new TextEncoder();

/** Indexes the vault's notes: uploads new and changed notes, deletes chunks of notes that are gone. */
export async function runNoteIndex(
	deps: {
		reader: NotesReader;
		client: NotesClient;
		state: NotesState;
		save: (state: NotesState) => Promise<void>;
		signal?: AbortSignal;
		now?: () => number;
		onProgress?: (done: number, total: number) => void;
	},
	filter: PathFilter,
): Promise<NotesSummary> {
	const { reader, client, state } = deps;
	const now = deps.now ?? Date.now;
	const include = compileFilter(filter);
	const summary: NotesSummary = {
		notesIndexed: 0,
		chunksUploaded: 0,
		chunksDeleted: 0,
		unchanged: 0,
		failed: [],
		truncated: [],
		cancelled: false,
	};
	const candidates = reader
		.list()
		.filter((f) => f.path.toLowerCase().endsWith('.md') && include(f.path))
		.sort((a, b) => a.path.localeCompare(b.path));

	// Scan: re-hash only notes whose size or mtime changed.
	const files: Record<string, FileStamp> = {};
	const texts = new Map<string, string>();
	for (const file of candidates) {
		if (deps.signal?.aborted) return { ...summary, cancelled: true };
		const known = state.files[file.path];
		if (known && known.size === file.size && known.mtime === file.mtime) {
			files[file.path] = known;
			continue;
		}
		try {
			const text = await reader.read(file.path);
			const hash = await sha256Hex(encoder.encode(text));
			files[file.path] = { hash, size: file.size, mtime: file.mtime };
			texts.set(hash, text);
		} catch (err) {
			if (known) files[file.path] = known;
			summary.failed.push({ path: file.path, reason: String(err) });
		}
	}
	state.files = files;

	if (state.needsPurge) {
		await client.deleteVault(state.vaultId);
		state.notes = {};
		delete state.needsPurge;
		await deps.save(state);
	}
	// Delete chunks of notes that are gone, changed (new hash) or excluded.
	const live = new Set(Object.values(files).map((f) => f.hash));
	const gone = Object.keys(state.notes).filter((h) => !live.has(h));
	const goneIds = gone.flatMap((h) => state.notes[h]?.ids ?? []);
	if (goneIds.length > 0) {
		const { lsn } = await client.deleteNotes(goneIds);
		if (lsn) state.lastLsn = lsn;
		summary.chunksDeleted = goneIds.length;
	}
	for (const h of gone) delete state.notes[h];

	// Upload notes not yet indexed, one note at a time (a crash loses at most one note).
	const pending = [
		...new Map(Object.entries(files).map(([p, f]) => [f.hash, p])).entries(),
	].filter(([hash]) => state.notes[hash]?.status !== 'indexed');
	summary.unchanged = live.size - pending.length;
	if (pending.length > 0) await client.ensureCollection();
	for (const [i, [hash, path]] of pending.entries()) {
		if (deps.signal?.aborted) {
			summary.cancelled = true;
			break;
		}
		deps.onProgress?.(i, pending.length);
		try {
			const text = texts.get(hash) ?? (await reader.read(path));
			const { chunks, truncated } = chunkNote(text);
			const docs: NoteDoc[] = chunks.map((c, n) => ({
				id: noteId(state.vaultId, hash, n),
				vaultId: state.vaultId,
				contentHash: hash,
				chunk: n,
				text: c.text,
				keywords: foldAccents(c.text),
			}));
			if (docs.length > 0) {
				const { lsn } = await client.upsertNotes(docs);
				if (lsn) state.lastLsn = lsn;
			}
			state.notes[hash] = {
				headings: chunks.map((c) => c.heading),
				ids: docs.map((d) => d.id),
				status: 'indexed',
				...(truncated ? { truncated: true } : {}),
				updatedAt: now(),
			};
			if (truncated) summary.truncated.push(path);
			summary.notesIndexed++;
			summary.chunksUploaded += docs.length;
		} catch (err) {
			// An upload error (offline, bad key) stops the run; the next run retries.
			await deps.save(state);
			throw err;
		}
		await deps.save(state);
	}
	await deps.save(state);
	return summary;
}

/** Note paths for each content hash, sorted. */
export function notePathsByHash(state: NotesState): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [path, stamp] of Object.entries(state.files)) {
		const list = out.get(stamp.hash);
		if (list) list.push(path);
		else out.set(stamp.hash, [path]);
	}
	for (const list of out.values()) list.sort();
	return out;
}
