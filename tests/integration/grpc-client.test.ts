import { afterEach, describe, expect, it } from 'vitest';
import { pageId, TopKError, type PageDoc } from '../../src/topk/client';
import { labelScorer } from '../../src/topk/fake';
import { GrpcTopKClient } from '../../src/topk/grpcClient';
import { startMockTopK, type MockTopK } from '../support/mockTopkServer';

let mock: MockTopK | undefined;
afterEach(async () => {
	await mock?.close();
	mock = undefined;
});

const page = (n: number, bytes = 100): PageDoc => ({
	id: pageId('hash', n),
	vaultId: 'vault-1',
	contentHash: 'hash',
	page: n,
	tile: 0,
	kind: 'pdf_page',
	image: { format: 'jpeg', bytes: new Uint8Array(bytes).fill(0xff) },
});

describe('GrpcTopKClient against the mock TopK server', () => {
	it('creates the collection once, upserts in batches and searches', async () => {
		mock = await startMockTopK({
			apiKey: 'k',
			scorer: labelScorer({ 'hash:3': 'reranker architecture' }),
		});
		const client = new GrpcTopKClient({
			apiKey: 'k',
			collection: 'pages',
			region: 'unused',
			endpoint: mock.origin,
			maxBatchBytes: 250_000,
		});
		expect(await client.ping()).toEqual({ collectionExists: false });
		await client.ensureCollection();
		await client.ensureCollection();
		expect(mock.created).toEqual(['pages']);
		expect(await client.ping()).toEqual({ collectionExists: true });

		const { lsn } = await client.upsertPages([1, 2, 3, 4].map((n) => page(n, 100_000)));
		expect(lsn).not.toBe('');
		expect(mock.fake.calls.upsertRequests).toBe(2);

		const hits = await client.search('reranker architecture slide', 20, 'vault-1', {
			requiredLsn: lsn,
		});
		expect(hits[0]).toMatchObject({
			id: 'hash:3:0',
			page: 3,
			kind: 'pdf_page',
			contentHash: 'hash',
		});
		expect(hits).toHaveLength(4);
		expect(await client.search('x', 20, 'another-vault')).toEqual([]);

		await client.deletePages(['hash:1:0']);
		expect(await client.search('x', 20, 'vault-1')).toHaveLength(3);
		client.close();
	});

	it('reports a wrong key as an auth error', async () => {
		mock = await startMockTopK({ apiKey: 'right' });
		const client = new GrpcTopKClient({
			apiKey: 'wrong',
			collection: 'c',
			region: 'x',
			endpoint: mock.origin,
		});
		const err = await client.ping().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(TopKError);
		expect((err as TopKError).kind).toBe('auth');
		client.close();
	});

	it('reports an unreachable endpoint as a network error', async () => {
		const client = new GrpcTopKClient({
			apiKey: 'k',
			collection: 'c',
			region: 'x',
			endpoint: 'http://127.0.0.1:1',
			timeoutMs: 2000,
		});
		const err = await client.ping().catch((e: unknown) => e);
		expect((err as TopKError).kind).toBe('network');
		client.close();
	});
});

describe('GrpcTopKClient retries', () => {
	const fast = {
		clock: { now: () => Date.now(), sleep: () => Promise.resolve(), random: () => 0 },
	};

	it('retries UNAVAILABLE and SlowDown transparently', async () => {
		mock = await startMockTopK({ apiKey: 'k' });
		const client = new GrpcTopKClient({
			apiKey: 'k',
			collection: 'c',
			region: 'x',
			endpoint: mock.origin,
			retry: fast,
		});
		await client.ensureCollection();
		mock.failNext(2, {
			code: 14,
			message: 'connection reset',
			path: '/topk.data.v1.WriteService/UpsertDocuments',
		});
		mock.failNext(1, {
			code: 8,
			message: 'slow down',
			topkCode: 1429,
			path: '/topk.data.v1.WriteService/UpsertDocuments',
		});
		await client.upsertPages([page(1)]);
		expect(mock.calls.filter((c) => c.endsWith('UpsertDocuments'))).toHaveLength(4);
		expect(mock.fake.docs.size).toBe(1);
		client.close();
	});

	it('does not retry a quota error and reports it as quota', async () => {
		mock = await startMockTopK({ apiKey: 'k' });
		const client = new GrpcTopKClient({
			apiKey: 'k',
			collection: 'c',
			region: 'x',
			endpoint: mock.origin,
			retry: fast,
		});
		await client.ensureCollection();
		mock.failNext(1, { code: 8, message: 'credits exhausted' });
		const err = await client.upsertPages([page(1)]).catch((e: unknown) => e);
		expect((err as TopKError).kind).toBe('quota');
		expect(mock.calls.filter((c) => c.endsWith('UpsertDocuments'))).toHaveLength(1);
		client.close();
	});

	it('waits out an LSN that is not visible yet', async () => {
		mock = await startMockTopK({ apiKey: 'k' });
		const client = new GrpcTopKClient({
			apiKey: 'k',
			collection: 'c',
			region: 'x',
			endpoint: mock.origin,
			retry: fast,
		});
		await client.ensureCollection();
		mock.failNext(3, {
			code: 9,
			message: 'lsn not ready',
			topkCode: 1000,
			path: '/topk.data.v1.QueryService/Query',
		});
		await expect(client.search('x', 5, 'vault-1', { requiredLsn: '1' })).resolves.toEqual([]);
		client.close();
	});
});
