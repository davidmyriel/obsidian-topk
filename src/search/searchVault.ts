import type { IndexState } from '../indexer/state';
import type { SearchHit, TopKClient } from '../topk/client';
import { containsPhrases, exactQuery, type ExactQuery } from './exact';
import type { ResolvedResult } from './links';
import { withNameMatches } from './nameMatch';
import { resolveHits } from './results';

// One search, as the plugin runs it (and the benchmark measures it):
// 1. Visual search: TopK ranks pages by how well their image matches the query.
// 2. For queries with exact parts (quoted phrases, codes like INV-2291), TopK's one-query hybrid
//    search runs in parallel: only pages whose text contains every term, ranked by visual score
//    plus a little BM25 (ADR-006). Phrases are checked for word order here, since TopK matches
//    their words in any order. These pages come first, marked as exact matches.
// 3. Short queries with no exact match also match file names on this device (nameMatch.ts).

export interface SearchVaultOptions {
	/** Results to show. */
	k: number;
	/** Hits to ask TopK for, so pages of deleted files can be dropped. */
	fetchK: number;
	requiredLsn?: string;
	exists?: (path: string) => boolean;
	/** Called when the exact-text query fails, e.g. on a collection without page text. */
	onExactError?: (err: unknown) => void;
	/** Set to false for visual search only (the benchmark's comparison). Default true. */
	exactText?: boolean;
}

export interface SearchVaultResult {
	results: ResolvedResult[];
	exact: ExactQuery | null;
	/** Pages that contain every exact term (and phrase); 0 when there were none or no exact part. */
	exactMatches: number;
}

export async function searchVault(
	client: TopKClient,
	query: string,
	state: IndexState,
	options: SearchVaultOptions,
): Promise<SearchVaultResult> {
	const exists = options.exists ?? (() => true);
	const lsn = options.requiredLsn ? { requiredLsn: options.requiredLsn } : {};
	const exact = options.exactText === false ? null : exactQuery(query);
	const [visual, exactHits] = await Promise.all([
		client.search(query, options.fetchK, state.vaultId, lsn),
		exact
			? client
					.search(query, options.fetchK, state.vaultId, {
						...lsn,
						exactTerms: exact.terms,
					})
					.catch((err: unknown): SearchHit[] => {
						options.onExactError?.(err);
						return [];
					})
			: Promise.resolve<SearchHit[]>([]),
	]);
	const matched =
		exact && exact.phrases.length > 0
			? exactHits.filter((h) => containsPhrases(h.pageText ?? '', exact.phrases))
			: exactHits;
	// TopK already ranked the exact hits by the hybrid score; resolveHits keeps that order.
	const exactResults = resolveHits(matched, state, options.k, exists, true).map((r) => ({
		...r,
		exactMatch: true,
	}));
	const key = (r: ResolvedResult): string => `${r.contentHash}:${r.page}`;
	const seen = new Set(exactResults.map(key));
	const merged = [
		...exactResults,
		...resolveHits(visual, state, options.k, exists).filter((r) => !seen.has(key(r))),
	].slice(0, options.k);
	const results =
		exactResults.length > 0 ? merged : withNameMatches(merged, query, state, options.k, exists);
	return { results, exact, exactMatches: exactResults.length };
}
