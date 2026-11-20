// TopK with topk-embed-v1, one entry per page, through the plugin's own indexing and search code.
// The index state is kept in bench/report/, so a rerun only uploads pages that are not there yet.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_INDEX_OPTIONS, runIndex } from '../../src/indexer/indexer';
import { emptyState, parseState, type IndexState } from '../../src/indexer/state';
import { withNameMatches } from '../../src/search/nameMatch';
import { resolveHits } from '../../src/search/results';
import { MODEL_MAX_PIXELS } from '../../src/settingsModel';
import { GrpcTopKClient } from '../../src/topk/grpcClient';
import { PRICES } from '../../src/util/cost';
import { DiskVault, nodeRenderEnv } from '../../tests/support/nodeVault';
import { BENCH, CORPUS_DIR } from '../corpus';
import type { PageRef } from '../metrics';
import type { IndexStats, Setup } from './types';

const VAULT_ID = 'bench';

export function topkSetup(): Setup | null {
	const apiKey = process.env.TOPK_API_KEY;
	if (!apiKey) return null;
	const collection = process.env.TOPK_BENCH_COLLECTION ?? 'bench-visual-search';
	const client = new GrpcTopKClient({
		apiKey,
		collection,
		region: process.env.TOPK_REGION ?? 'aws-us-east-1-elastica',
	});
	const statePath = join(BENCH, 'report', `topk-state-${collection}.json`);
	const statsPath = join(BENCH, 'report', `topk-index-stats-${collection}.json`);
	let state: IndexState = emptyState(VAULT_ID, collection);
	return {
		id: 'topk',
		label: 'TopK, topk-embed-v1, one entry per page (this plugin)',
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
			const hits = await client.search(query, k * 2, VAULT_ID, {
				...(state.lastLsn ? { requiredLsn: state.lastLsn } : {}),
			});
			// The same ranking as the plugin, including file-name matching for short queries.
			return withNameMatches(resolveHits(hits, state, k), query, state, k).map((r) => ({
				file: r.path,
				page: r.page,
			}));
		},
		close: () => client.close(),
	};
}
