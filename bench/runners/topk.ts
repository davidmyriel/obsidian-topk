// TopK with topk-embed-v1, one entry per page, through the plugin's own indexing and search code.
// The index state is kept in bench/report/, so a rerun only uploads pages that are not there yet.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_INDEX_OPTIONS, runIndex } from '../../src/indexer/indexer';
import { emptyState, parseState, type IndexState } from '../../src/indexer/state';
import { searchVault } from '../../src/search/searchVault';
import { MODEL_MAX_PIXELS } from '../../src/settingsModel';
import { GrpcTopKClient } from '../../src/topk/grpcClient';
import { PRICES } from '../../src/util/cost';
import { DiskVault, nodeRenderEnv } from '../../tests/support/nodeVault';
import { BENCH, CORPUS_DIR } from '../corpus';
import type { PageRef } from '../metrics';
import type { IndexStats, Setup } from './types';

const VAULT_ID = 'bench';

/**
 * The plugin's search. With `exactText: false`, visual search only, to measure what hybrid adds.
 * Both variants share one index.
 */
export function topkSetup(exactText = true): Setup | null {
	const apiKey = process.env.TOPK_API_KEY;
	if (!apiKey) return null;
	const collection = process.env.TOPK_BENCH_COLLECTION ?? 'bench-visual-search-v2';
	const client = new GrpcTopKClient({
		apiKey,
		collection,
		region: process.env.TOPK_REGION ?? 'aws-us-east-1-elastica',
	});
	const statePath = join(BENCH, 'report', `topk-state-${collection}.json`);
	const statsPath = join(BENCH, 'report', `topk-index-stats-${collection}.json`);
	let state: IndexState = emptyState(VAULT_ID, collection);
	return {
		id: exactText ? 'topk' : 'topk-visual',
		label: exactText
			? 'TopK hybrid: visual + exact text (this plugin)'
			: 'TopK visual only (topk-embed-v1, one entry per page)',
		async index(): Promise<IndexStats> {
			if (existsSync(statePath)) {
				state = parseState(
					JSON.parse(readFileSync(statePath, 'utf8')),
					() => VAULT_ID,
					collection,
				);
			}
			const save = (s: IndexState): Promise<void> => {
				writeFileSync(statePath, JSON.stringify(s));
				return Promise.resolve();
			};
			const started = performance.now();
			const summary = await runIndex(
				{ reader: new DiskVault(CORPUS_DIR), client, env: nodeRenderEnv, state, save },
				{
					...DEFAULT_INDEX_OPTIONS,
					includeFolders: [],
					excludeGlobs: [],
					maxPagesPerFile: 300,
					maxPixels: MODEL_MAX_PIXELS,
				},
			);
			await save(state);
			const pages = Object.values(state.hashes).reduce((n, h) => n + h.ids.length, 0);
			const notes = [
				`${summary.pagesUploaded} pages uploaded this run; ${pages} in the index.`,
				...summary.failed.map((f) => `failed: ${f.path}: ${f.reason}`),
			];
			const stats: IndexStats = {
				seconds: (performance.now() - started) / 1000,
				pages,
				// Embedding is the dominant cost; writes and storage add well under a cent here.
				costUsd: pages * PRICES.embedPerImage,
				notes,
			};
			// A rerun with nothing to upload reports the time of the run that built the index.
			if (summary.pagesUploaded === pages && summary.failed.length === 0) {
				writeFileSync(statsPath, JSON.stringify(stats));
			} else if (summary.pagesUploaded === 0 && existsSync(statsPath)) {
				const first = JSON.parse(readFileSync(statsPath, 'utf8')) as IndexStats;
				return {
					...first,
					notes: [...notes, 'Index time is from the run that built the index.'],
				};
			}
			return stats;
		},
		async search(query: string, k: number): Promise<PageRef[]> {
			const { results } = await searchVault(client, query, state, {
				k,
				fetchK: k * 2,
				exactText,
				...(state.lastLsn ? { requiredLsn: state.lastLsn } : {}),
			});
			return results.map((r) => ({ file: r.path, page: r.page }));
		},
		close: () => client.close(),
	};
}
