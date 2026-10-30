import { pathsByHash, type IndexState } from './state';

export interface IndexStatus {
	files: number;
	pages: number;
	/** Files currently uploaded in part (interrupted); finished on the next run. */
	partial: number;
	failed: { path: string; reason: string }[];
	skipped: { path: string; reason: string }[];
	lastIndexed: number | null;
}

/** What the index holds, per current path, for the status panel. */
export function indexStatus(state: IndexState): IndexStatus {
	const status: IndexStatus = {
		files: 0,
		pages: 0,
		partial: 0,
		failed: [],
		skipped: [],
		lastIndexed: null,
	};
	for (const [hash, paths] of pathsByHash(state)) {
		const entry = state.hashes[hash];
		const path = paths[0];
		if (!entry || !path) continue;
		status.lastIndexed =
			Math.max(status.lastIndexed ?? 0, entry.updatedAt) || status.lastIndexed;
		if (entry.status === 'indexed') {
			status.files += paths.length;
			status.pages += entry.pageCount;
		} else if (entry.status === 'partial') {
			status.partial += paths.length;
		} else if (entry.status === 'failed') {
			for (const p of paths)
				status.failed.push({ path: p, reason: entry.reason ?? 'unknown error' });
		} else {
			for (const p of paths)
				status.skipped.push({ path: p, reason: entry.reason ?? 'skipped' });
		}
	}
	status.failed.sort((a, b) => a.path.localeCompare(b.path));
	status.skipped.sort((a, b) => a.path.localeCompare(b.path));
	return status;
}
