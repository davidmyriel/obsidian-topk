import { describe, expect, it } from 'vitest';
import { costSentence, estimateCost, formatUsd, PRICES } from '../../src/util/cost';

describe('cost estimate', () => {
	it('charges embedding per image plus upload bytes and requests', () => {
		const est = estimateCost(1000, { avgPageBytes: 100 * 1024, batchBytes: 4 * 1024 * 1024 });
		const gib = (1000 * 100 * 1024) / 1024 ** 3;
		const requests = Math.ceil((1000 * 100 * 1024) / (4 * 1024 * 1024));
		expect(est.oneTime).toBeCloseTo(
			1000 * PRICES.embedPerImage + gib * 0.5 + requests * 0.00001,
			6,
		);
		expect(est.perMonth).toBeCloseTo(gib * 0.1, 6);
	});

	it('matches the numbers in docs: about $0.13 per 1,000 pages', () => {
		const { oneTime } = estimateCost(1000);
		expect(oneTime).toBeGreaterThan(0.09);
		expect(oneTime).toBeLessThan(0.15);
	});

	it('formats small and normal amounts', () => {
		expect(formatUsd(0.004)).toBe('less than $0.01');
		expect(formatUsd(0.134)).toBe('$0.13');
		expect(costSentence(20)).toBe(
			'Estimated TopK cost: less than a cent to index, under a cent a month to store.',
		);
		expect(costSentence(100_000)).toMatch(
			/^Estimated TopK cost: about \$\d+\.\d\d to index, about \$\d+\.\d\d a month to store\.$/,
		);
	});
});
