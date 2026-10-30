import { describe, expect, it } from 'vitest';
import { isTall, TILE_OVERLAP, tileRects } from '../../src/render/tiles';

describe('tileRects', () => {
	it('leaves ordinary images whole', () => {
		expect(tileRects(800, 600)).toEqual([{ x: 0, y: 0, width: 800, height: 600 }]);
		expect(tileRects(800, 2000)).toHaveLength(1); // 2.5x exactly is not tall
		expect(isTall(800, 2001)).toBe(true);
	});

	it('covers a tall screenshot top to bottom with page-shaped, overlapping tiles', () => {
		const rects = tileRects(1000, 6000);
		const h = Math.round(1000 * Math.SQRT2);
		expect(rects.every((r) => r.width === 1000 && r.height === h && r.x === 0)).toBe(true);
		expect(rects[0]?.y).toBe(0);
		expect(rects.at(-1)?.y).toBe(6000 - h); // last tile ends at the bottom
		for (let i = 1; i < rects.length; i++) {
			const prev = rects[i - 1];
			const cur = rects[i];
			if (!prev || !cur) continue;
			const overlap = prev.y + prev.height - cur.y;
			expect(overlap).toBeGreaterThanOrEqual(Math.floor(h * TILE_OVERLAP)); // at least 10%
			expect(cur.y).toBeGreaterThan(prev.y);
		}
		expect(rects).toHaveLength(5);
	});

	it('handles a very narrow, very tall strip', () => {
		const rects = tileRects(100, 100_000);
		expect(rects.at(-1)?.y).toBe(100_000 - 141);
		expect(rects.length).toBeGreaterThan(700);
	});
});
