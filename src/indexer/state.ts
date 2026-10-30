import type { SourceKind } from '../render/pageSource';

// Local index state, persisted as JSON in the plugin folder. Paths live only here; TopK sees
// content hashes (ADR-002). Bump STATE_VERSION when the shape changes.

export const STATE_VERSION = 2;

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
	/**
	 * Delete everything this vault has in TopK before the next upload: set after a rebuild,
	 * "Clear local index", or a migration from state version 1 (ids without the vault id).
	 */
	needsPurge?: boolean;
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
	if (!isRecord(raw) || typeof raw.vaultId !== 'string' || !raw.vaultId) {
		return emptyState(newVaultId(), collection);
	}
	if (raw.version === 1) {
		// Version 1 ids lacked the vault id: keep the vault id and file hashes, purge and re-upload.
		const migrated = parseState(
			{ ...raw, version: STATE_VERSION, hashes: {}, lastLsn: undefined },
			newVaultId,
			collection,
		);
		migrated.needsPurge = true;
		return migrated;
	}
	if (raw.version !== STATE_VERSION) return emptyState(newVaultId(), collection);
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
	if (raw.needsPurge === true) state.needsPurge = true;
	// Hashes uploaded to another collection are not searchable in this one.
	if (raw.collection !== collection) {
		state.hashes = {};
		delete state.needsPurge;
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

/** Hashes with uploads whose content no longer exists at any included path. */
export function orphanedHashes(state: IndexState, files: Record<string, FileStamp>): string[] {
	const live = new Set(Object.values(files).map((f) => f.hash));
	return Object.keys(state.hashes).filter((hash) => !live.has(hash));
}

/** Forgets every upload, keeping the vault id, and marks the vault for a purge in TopK. */
export function resetUploads(state: IndexState): void {
	state.hashes = {};
	delete state.lastLsn;
	state.needsPurge = true;
}

/** Re-keys files at oldPath, or under it when it is a folder, to newPath. Returns true if any moved. */
export function renamePaths(state: IndexState, oldPath: string, newPath: string): boolean {
	let moved = false;
	for (const path of Object.keys(state.files)) {
		const target =
			path === oldPath
				? newPath
				: path.startsWith(`${oldPath}/`)
					? newPath + path.slice(oldPath.length)
					: null;
		const stamp = state.files[path];
		if (target === null || !stamp) continue;
		delete state.files[path];
		state.files[target] = stamp;
		moved = true;
	}
	return moved;
}
