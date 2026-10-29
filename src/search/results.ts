import type { IndexState } from '../indexer/state';
import { pathsByHash } from '../indexer/state';
import type { SearchHit } from '../topk/client';
import type { ResolvedResult } from './links';

/**
 * Maps TopK hits (content hashes) to current vault paths, best first. Hits whose content no
 * longer exists in the vault are dropped, so deleted files never show up.
 */
export function resolveHits(hits: SearchHit[], state: IndexState, limit: number): ResolvedResult[] {
	const paths = pathsByHash(state);
	const out: ResolvedResult[] = [];
	const seen = new Set<string>();
	for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
		const path = paths.get(hit.contentHash)?.[0];
		const key = `${hit.contentHash}:${hit.page}`;
		if (!path || seen.has(key)) continue; // tiles of one image collapse into one result
		seen.add(key);
		out.push({
			path,
			page: hit.page,
			kind: hit.kind,
			score: hit.score,
			contentHash: hit.contentHash,
		});
		if (out.length >= limit) break;
	}
	return out;
}
