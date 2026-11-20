import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { emptyState, type IndexState } from '../../src/indexer/state';
import {
	containsPhrases,
	exactQuery,
	MAX_PAGE_TEXT,
	pageTextForIndex,
} from '../../src/search/exact';
import { searchVault } from '../../src/search/searchVault';
import { nextCollectionName } from '../../src/settingsModel';
import { FakeTopK, textTokens } from '../../src/topk/fake';
import { QueryRequestSchema } from '../../src/topk/gen/topk/data/v1/query_service_pb';
import { searchRequest, TEXT_FIELD } from '../../src/topk/requests';
import type { PageDoc } from '../../src/topk/client';

describe('exactQuery', () => {
	it('picks quoted phrases and identifiers with letters and digits', () => {
		expect(exactQuery('invoice INV-2291 total')).toEqual({ terms: ['INV-2291'], phrases: [] });
		expect(exactQuery('p99 latency on v0.16.1')).toEqual({
			terms: ['p99', 'v0.16.1'],
			phrases: [],
		});
		expect(exactQuery('"Reciprocal Rank Fusion" diagram')).toEqual({
			terms: ['Reciprocal', 'Rank', 'Fusion'],
			phrases: ['reciprocal rank fusion'],
		});
		expect(exactQuery('"crème brûlée"')).toEqual({
			terms: ['creme', 'brulee'],
			phrases: ['creme brulee'],
		});
	});

	it('leaves descriptive queries alone', () => {
		for (const q of [
			'3D loss landscape surfaces',
			'temperature 0.7 for the models',
			'hand-drawn sketch of messy code',
			'GPT vision models counting blobs',
			'old world map',
		]) {
			expect(exactQuery(q), q).toBeNull();
		}
	});
});

describe('containsPhrases', () => {
	it('requires the words in order, ignoring case, accents and punctuation', () => {
		const text = 'We use Reciprocal  rank-fusion; then crème brûlée.';
		expect(containsPhrases(text, ['reciprocal rank fusion'])).toBe(true);
		expect(containsPhrases(text, ['creme brulee'])).toBe(true);
		expect(
			containsPhrases('Fusion of rank lists is not reciprocal', ['reciprocal rank fusion']),
		).toBe(false);
		expect(containsPhrases(text, [])).toBe(true);
	});
});

describe('pageTextForIndex', () => {
	it('folds accents, collapses spaces, drops empty text and caps the length', () => {
		expect(pageTextForIndex('  Crème\n\nbrûlée  ')).toBe('Creme brulee');
		expect(pageTextForIndex(' \n ')).toBeUndefined();
		// A word split at a line break is rejoined; a real hyphen between words stays.
		expect(pageTextForIndex('but decen- tralized execution, state- Of the art')).toBe(
			'but decentralized execution, state- Of the art',
		);
		expect(pageTextForIndex('x'.repeat(MAX_PAGE_TEXT + 10))).toHaveLength(MAX_PAGE_TEXT);
	});
});

describe('nextCollectionName', () => {
	it('adds or bumps a -vN suffix', () => {
		expect(nextCollectionName('obsidian-visual-search')).toBe('obsidian-visual-search-v2');
		expect(nextCollectionName('pages-v2')).toBe('pages-v3');
		expect(nextCollectionName('x'.repeat(128)).length).toBeLessThanOrEqual(128);
	});
});

describe('searchRequest with exact terms', () => {
	it("adds BM25, the page text, a text filter and the hybrid sort, as TopK's docs show", () => {
		const req = fromBinary(
			QueryRequestSchema,
			toBinary(QueryRequestSchema, searchRequest('invoice', 'v1', 20, ['INV-2291'])),
		);
		const stages = req.query?.stages.map((s) => s.stage) ?? [];
		const select = stages[0];
		expect(select?.case).toBe('select');
		if (select?.case !== 'select') return;
		expect(Object.keys(select.value.exprs).sort()).toContain('text_score');
		expect(Object.keys(select.value.exprs)).toContain(TEXT_FIELD);
		const text = stages[2];
		expect(text?.case === 'filter' && text.value.expr?.expr.case).toBe('textExpr');
		const sort = stages[3];
		expect(sort?.case === 'sort' && sort.value.exprs[0]?.expr?.expr.case).toBe('binaryOp');
		// Without exact terms the request is the plain visual one.
		expect(searchRequest('invoice', 'v1', 20).query?.stages).toHaveLength(4);
	});
});

describe('textTokens (fake keyword index)', () => {
	it('splits like TopK: whole tokens, case ignored, trailing punctuation dropped', () => {
		expect([...textTokens('Invoice INV-2291, due v0.16.1.')]).toEqual([
			'invoice',
			'inv-2291',
			'due',
			'v0.16.1',
		]);
	});
});

const doc = (id: string, page: number, pageText?: string): PageDoc => ({
	id,
	vaultId: 'v',
	contentHash: id,
	page,
	tile: 0,
	kind: 'pdf_page',
	image: { format: 'jpeg', bytes: new Uint8Array([1]) },
	...(pageText ? { pageText } : {}),
});

function stateFor(ids: string[]): IndexState {
	const state = emptyState('v', 'c');
	for (const id of ids) {
		state.files[`${id}.pdf`] = { hash: id, size: 1, mtime: 1 };
		state.hashes[id] = {
			kind: 'pdf',
			extension: 'pdf',
			pageCount: 1,
			ids: [id],
			status: 'indexed',
			updatedAt: 0,
		};
	}
	return state;
}

describe('searchVault', () => {
	// Visual scores rank the near-duplicate invoices by id, so INV-2299 looks best.
	const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
	const fake = new FakeTopK((_q, page) => scores[page.contentHash] ?? 0);
	fake.collectionExists = true;
	for (const d of [
		doc('a', 1, 'Invoice INV-2291 Acme'),
		doc('b', 1, 'Invoice INV-2290 Acme'),
		doc('c', 1, 'Invoice INV-2299 Acme reciprocal rank fusion'),
	]) {
		fake.docs.set(d.id, d);
	}
	const state = stateFor(['a', 'b', 'c']);
	const opts = { k: 10, fetchK: 20 };

	it('puts pages containing the exact term first, then the visual results', async () => {
		const { results, exactMatches } = await searchVault(fake, 'invoice INV-2291', state, opts);
		expect(exactMatches).toBe(1);
		expect(results.map((r) => [r.path, r.exactMatch ?? false])).toEqual([
			['a.pdf', true],
			['c.pdf', false],
			['b.pdf', false],
		]);
	});

	it('checks phrase order on the page text', async () => {
		const { results } = await searchVault(fake, '"rank reciprocal fusion"', state, opts);
		expect(results.some((r) => r.exactMatch)).toBe(false);
		const ok = await searchVault(fake, '"reciprocal rank fusion"', state, opts);
		expect(ok.results[0]).toMatchObject({ path: 'c.pdf', exactMatch: true });
	});

	it('falls back to visual results when the exact query fails', async () => {
		const failing = new FakeTopK((_q, page) => scores[page.contentHash] ?? 0);
		failing.collectionExists = true;
		for (const d of fake.docs.values()) failing.docs.set(d.id, d);
		const original = failing.search.bind(failing);
		failing.search = (q, k, v, o) =>
			o?.exactTerms ? Promise.reject(new Error('no page_text field')) : original(q, k, v, o);
		const errors: unknown[] = [];
		const { results } = await searchVault(failing, 'INV-2291', state, {
			...opts,
			onExactError: (e) => errors.push(e),
		});
		expect(errors).toHaveLength(1);
		expect(results.map((r) => r.path)).toEqual(['c.pdf', 'b.pdf', 'a.pdf']);
	});
});
