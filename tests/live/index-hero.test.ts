// Live: indexes the 20 fixture pages into a throwaway TopK collection with the real pipeline,
// checks the hero query, and deletes the collection. Runs only when TOPK_API_KEY is set.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_INDEX_OPTIONS, runIndex } from '../../src/indexer/indexer';
import { emptyState, pathsByHash } from '../../src/indexer/state';
import { CollectionService } from '../../src/topk/gen/topk/control/v1/collection_service_pb';
import { GrpcTransport, regionOrigin } from '../../src/topk/grpc';
import { GrpcTopKClient } from '../../src/topk/grpcClient';
import { resolveHits } from '../../src/search/results';
import { FIXTURE_PAGE_COUNT, FIXTURE_VAULT, HERO, HERO_QUERY } from '../support/fixtures';
import { DiskVault, nodeRenderEnv } from '../support/nodeVault';

const apiKey = process.env.TOPK_API_KEY ?? '';
const region = process.env.TOPK_REGION ?? 'aws-us-east-1-elastica';
const collection = `live-${randomUUID().slice(0, 8)}`;

describe.skipIf(!apiKey)('live TopK', () => {
	const client = new GrpcTopKClient({ apiKey, collection, region });

	afterAll(async () => {
		client.close();
		const control = new GrpcTransport({
			origin: regionOrigin(region),
			headers: { authorization: `Bearer ${apiKey}` },
		});
		try {
			await control.unary(CollectionService.method.deleteCollection, { name: collection });
		} finally {
			control.close();
		}
	});

	it('indexes 20 fixture pages and ranks the hero page first', async () => {
		const state = emptyState(randomUUID(), collection);
		const summary = await runIndex(
			{
				reader: new DiskVault(FIXTURE_VAULT),
				client,
				env: nodeRenderEnv,
				state,
				save: () => Promise.resolve(),
			},
			{
				...DEFAULT_INDEX_OPTIONS,
				includeFolders: [],
				excludeGlobs: [],
				maxPagesPerFile: 300,
				maxPixels: 1_310_720,
			},
		);
		expect(summary).toMatchObject({
			pagesUploaded: FIXTURE_PAGE_COUNT,
			failed: [],
			skipped: [],
		});

		const started = performance.now();
		const hits = await client.search(HERO_QUERY, 20, state.vaultId, {
			requiredLsn: state.lastLsn ?? '',
		});
		const ms = performance.now() - started;
		const results = resolveHits(hits, state, 10);
		console.log(
			`live: hero query in ${Math.round(ms)} ms; top 3:`,
			results.slice(0, 3).map((r) => `${r.path}#${r.page} ${r.score.toFixed(2)}`),
		);
		expect(results[0]).toMatchObject({ path: HERO.path, page: HERO.page });
		expect(pathsByHash(state).size).toBe(4);
	});
});
