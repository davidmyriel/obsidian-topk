import { describe, expect, it } from 'vitest';
import { bootstrapCi, ndcgAt, reciprocalRank, recallAt, score } from '../../bench/metrics';

const rel = [{ file: 'a.pdf', pages: [3] }];
const r = (file: string, page: number) => ({ file, page });

describe('bench metrics', () => {
	it('recall@k is 1 when the page is in the top k', () => {
		const results = [r('b.pdf', 1), r('a.pdf', 3)];
		expect(recallAt(results, rel, 1)).toBe(0);
		expect(recallAt(results, rel, 2)).toBe(1);
		expect(recallAt([r('a.pdf', 4)], rel, 5)).toBe(0); // right file, wrong page
	});

	it('reciprocal rank uses the first relevant page', () => {
		expect(reciprocalRank([r('x', 1), r('y', 1), r('a.pdf', 3)], rel)).toBeCloseTo(1 / 3);
		expect(reciprocalRank([], rel)).toBe(0);
	});

	it('nDCG@10 is 1 for a perfect ranking and counts a two-page answer twice', () => {
		expect(ndcgAt([r('a.pdf', 3)], rel, 10)).toBe(1);
		expect(ndcgAt([r('x', 1), r('a.pdf', 3)], rel, 10)).toBeCloseTo(1 / Math.log2(3));
		const two = [{ file: 'a.pdf', pages: [3, 4] }];
		expect(ndcgAt([r('a.pdf', 3)], two, 10)).toBeCloseTo(1 / (1 + 1 / Math.log2(3)));
		// A repeated page earns nothing the second time.
		expect(ndcgAt([r('a.pdf', 3), r('a.pdf', 3)], two, 10)).toBeCloseTo(
			1 / (1 + 1 / Math.log2(3)),
		);
	});

	it('averages over queries', () => {
		const s = score([
			{ results: [r('a.pdf', 3)], relevant: rel },
			{ results: [r('x', 1)], relevant: rel },
		]);
		expect(s).toEqual({ queries: 2, recall1: 0.5, recall5: 0.5, ndcg10: 0.5, mrr: 0.5 });
	});
});

describe('bootstrapCi', () => {
	it('brackets the mean and is reproducible', () => {
		const values = [...Array<number>(40).fill(1), ...Array<number>(10).fill(0)];
		const [lo, hi] = bootstrapCi(values);
		expect(lo).toBeLessThan(0.8);
		expect(hi).toBeGreaterThan(0.8);
		expect(hi - lo).toBeLessThan(0.3);
		expect(bootstrapCi(values)).toEqual([lo, hi]);
		expect(bootstrapCi([1, 1, 1])).toEqual([1, 1]);
	});
});
