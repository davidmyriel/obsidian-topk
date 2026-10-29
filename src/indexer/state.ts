import type { SourceKind } from '../render/pageSource';

// Local index state, persisted as JSON in the plugin folder. Paths live only here; TopK sees
// content hashes (ADR-002). Bump STATE_VERSION when the shape changes.

export const STATE_VERSION = 1;

export interface FileStamp {
	hash: string;
	size: number;
	mtime: number;
}

/**
 * indexed: every page uploaded. partial: interrupted mid-file. failed: rendering or upload error.
 * skipped: over the page limit.
 */
export type HashStatus = 'indexed' | 'partial' | 'failed' | 'skipped';

export interface HashEntry {
	kind: SourceKind;
	extension: string;
	pageCount: number;
	ids: string[];
	status: HashStatus;
	reason?: string;
	updatedAt: number;
}

export interface IndexState {
	version: number;
	/** Random per vault; every TopK document carries it and every search filters on it. */
	vaultId: string;
	/** Collection the hashes were uploaded to. */
	collection: string;
	files: Record<string, FileStamp>;
	hashes: Record<string, HashEntry>;
	lastLsn?: string;
}

export function emptyState(vaultId: string, collection: string): IndexState {
	return { version: STATE_VERSION, vaultId, collection, files: {}, hashes: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const STATUSES: readonly HashStatus[] = ['indexed', 'partial', 'failed', 'skipped'];

/**
 * Validates persisted JSON. Anything unreadable or from another version yields a fresh state, so a
 * bad file costs a re-index rather than a crash.
 */
export function parseState(raw: unknown, newVaultId: () => string, collection: string): IndexState {
	if (
		!isRecord(raw) ||
		raw.version !== STATE_VERSION ||
		typeof raw.vaultId !== 'string' ||
		!raw.vaultId
	) {
		return emptyState(newVaultId(), collection);
	}
	const files: Record<string, FileStamp> = {};
	if (isRecord(raw.files)) {
		for (const [path, v] of Object.entries(raw.files)) {
			if (
				isRecord(v) &&
				typeof v.hash === 'string' &&
				typeof v.size === 'number' &&
				typeof v.mtime === 'number'
			) {
				files[path] = { hash: v.hash, size: v.size, mtime: v.mtime };
			}
		}
	}
	const hashes: Record<string, HashEntry> = {};
	if (isRecord(raw.hashes)) {
		for (const [hash, v] of Object.entries(raw.hashes)) {
			if (
				isRecord(v) &&
				(v.kind === 'pdf' || v.kind === 'image') &&
				typeof v.extension === 'string' &&
				typeof v.pageCount === 'number' &&
				Array.isArray(v.ids) &&
				STATUSES.includes(v.status as HashStatus)
			) {
				hashes[hash] = {
					kind: v.kind,
					extension: v.extension,
					pageCount: v.pageCount,
					ids: v.ids.filter((id): id is string => typeof id === 'string'),
					status: v.status as HashStatus,
					...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
					updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
				};
			}
		}
	}
	const state: IndexState = {
		version: STATE_VERSION,
		vaultId: raw.vaultId,
		collection,
		files,
		hashes,
	};
	// Hashes uploaded to another collection are not searchable in this one.
	if (raw.collection !== collection) {
		state.hashes = {};
	} else if (typeof raw.lastLsn === 'string') {
		state.lastLsn = raw.lastLsn;
	}
	return state;
}

/** Current vault paths for each content hash, sorted. Identical files share one hash. */
export function pathsByHash(state: IndexState): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [path, stamp] of Object.entries(state.files)) {
		const list = out.get(stamp.hash);
		if (list) list.push(path);
		else out.set(stamp.hash, [path]);
	}
	for (const list of out.values()) list.sort();
	return out;
}
