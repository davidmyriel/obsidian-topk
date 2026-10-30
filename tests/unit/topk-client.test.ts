import { describe, expect, it } from 'vitest';
import { batchByBytes, pageId, toTopKError, TopKError, type PageDoc } from '../../src/topk/client';
import { FakeTopK, labelScorer } from '../../src/topk/fake';
import { GrpcCode, GrpcError, TopKErrorCode } from '../../src/topk/grpc';
import { assertSchema } from '../../src/topk/grpcClient';
import { createCollectionRequest } from '../../src/topk/requests';
import { redact } from '../../src/util/logger';
import { sha256Hex } from '../../src/util/hash';

const page = (n: number, bytes = 10, vaultId = 'v1'): PageDoc => ({
	id: pageId('h', n),
	vaultId,
	contentHash: 'h',
	page: n,
	tile: 0,
	kind: 'pdf_page',
	image: { format: 'jpeg', bytes: new Uint8Array(bytes) },
});

describe('ids and hashing', () => {
	it('builds ids from content hash, page and tile', () => {
		expect(pageId('9f2c41a0', 15)).toBe('9f2c41a0:15:0');
		expect(pageId('9f2c41a0', 2, 3)).toBe('9f2c41a0:2:3');
	});

	it('hashes bytes with SHA-256', async () => {
		expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});
});

describe('batchByBytes', () => {
	it('keeps batches under the byte budget and preserves order', () => {
		const pages = [1, 2, 3, 4, 5].map((n) => page(n, 1000));
		const batches = batchByBytes(pages, 3100);
		expect(batches.map((b) => b.map((p) => p.page))).toEqual([[1, 2], [3, 4], [5]]);
	});

	it('gives an oversized page its own batch', () => {
		expect(
			batchByBytes([page(1, 10), page(2, 5000), page(3, 10)], 1000).map((b) => b.length),
		).toEqual([1, 1, 1]);
		expect(batchByBytes([], 1000)).toEqual([]);
	});
});

describe('toTopKError', () => {
	it.each([
		[GrpcCode.UNAUTHENTICATED, 'Invalid api key', 'auth'],
		[GrpcCode.INVALID_ARGUMENT, 'authorization header not provided', 'auth'],
		[GrpcCode.INVALID_ARGUMENT, 'image exceeds 512KB', 'invalid'],
		[GrpcCode.UNAVAILABLE, 'connect ECONNREFUSED', 'network'],
		[GrpcCode.RESOURCE_EXHAUSTED, 'credits exhausted', 'quota'],
		[GrpcCode.INTERNAL, 'boom', 'unknown'],
	])('maps code %i "%s" to %s', (code, details, kind) => {
		expect(toTopKError(new GrpcError(code, details)).kind).toBe(kind);
	});

	it('maps TopK SlowDown (x-topk-error-code 1429) to rate_limit', () => {
		const err = new GrpcError(
			GrpcCode.RESOURCE_EXHAUSTED,
			'slow down',
			200,
			TopKErrorCode.SLOW_DOWN,
		);
		expect(toTopKError(err).kind).toBe('rate_limit');
	});
});

describe('assertSchema', () => {
	it('accepts the plugin schema and rejects others', () => {
		const ok = {
			...createCollectionRequest('c'),
			orgId: '',
			projectId: '',
			region: '',
			createdAt: '',
		};
		expect(() => assertSchema(ok as never)).not.toThrow();
		const bad = { name: 'c', schema: {} };
		expect(() => assertSchema(bad as never)).toThrow(TopKError);
	});
});

describe('redact', () => {
	it('masks registered secrets, bearer tokens and key-shaped strings but not hex hashes', () => {
		const key = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG';
		const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
		expect(redact(`key=${key}`)).toBe('key=[redacted]');
		expect(redact('authorization: Bearer abc.def')).toBe('authorization: Bearer [redacted]');
		expect(redact('short secret here', ['secret here'])).toBe('short [redacted]');
		expect(redact(`hash ${hash}`)).toBe(`hash ${hash}`);
	});
});

describe('FakeTopK', () => {
	it('filters by vault, ranks by the scorer and counts calls', async () => {
		const fake = new FakeTopK(labelScorer({ 'h:2': 'reranker architecture diagram' }));
		await fake.ensureCollection();
		await fake.upsertPages([page(1), page(2), page(3, 10, 'other')]);
		const hits = await fake.search('the reranker diagram', 10, 'v1');
		expect(hits.map((h) => h.page)).toEqual([2, 1]);
		expect(fake.calls).toMatchObject({ upsertRequests: 1, upsertedPages: 3, search: 1 });
	});

	it('rejects writes before the collection exists', async () => {
		await expect(new FakeTopK().upsertPages([page(1)])).rejects.toThrow(/collection/);
	});
});
