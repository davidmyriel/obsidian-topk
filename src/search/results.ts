import type { IndexState } from '../indexer/state';
import { pathsByHash } from '../indexer/state';
import type { SearchHit } from '../topk/client';
import type { ResolvedResult } from './links';

/**
 * Maps TopK hits (content hashes) to current vault paths, best first. Paths are checked against
 * the vault right now (`exists`), because the index only learns about deletes at the next run;
 * hits with no existing path are dropped, so a result never points at a missing file (beta 1 F8).
 */
export function resolveHits(
	hits: SearchHit[],
	state: IndexState,
	limit: number,
	exists: (path: string) => boolean = () => true,
): ResolvedResult[] {
	const paths = pathsByHash(state);
	const out: ResolvedResult[] = [];
	const seen = new Set<string>();
	for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
		const path = paths.get(hit.contentHash)?.find(exists);
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

/** TopK rejects longer query text (beta 1 F12). */
export const MAX_QUERY_CHARS = 4096;

/** The query trimmed and cut to TopK's limit, counting characters rather than UTF-16 units. */
export function cleanQuery(text: string): string {
	const chars = Array.from(text.trim());
	return chars.length > MAX_QUERY_CHARS
		? chars.slice(0, MAX_QUERY_CHARS).join('').trim()
		: text.trim();
}
