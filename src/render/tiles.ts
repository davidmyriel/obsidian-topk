// Tall images (screenshots, infographics) are split into page-shaped tiles before embedding, so
// each part keeps enough detail. Pure geometry; see pageSource.ts for the rendering.

/** Images taller than this many times their width are tiled (docs/PLAN.md Stage 2). */
export const TALL_RATIO = 2.5;
/** Tile height as a multiple of the width: A4 portrait. */
export const TILE_ASPECT = Math.SQRT2;
/** Fraction of each tile repeated in the next, so content on a boundary appears whole once. */
export const TILE_OVERLAP = 0.1;

export interface TileRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function isTall(width: number, height: number): boolean {
	return height > width * TALL_RATIO;
}

/**
 * Vertical tiles covering the whole image, top to bottom, each `width × width·√2` with 10% overlap.
 * The last tile is aligned to the bottom edge, so it may overlap its neighbour more.
 */
export function tileRects(width: number, height: number): TileRect[] {
	if (!isTall(width, height)) return [{ x: 0, y: 0, width, height }];
	const tileHeight = Math.round(width * TILE_ASPECT);
	const step = Math.max(1, Math.floor(tileHeight * (1 - TILE_OVERLAP)));
	const rects: TileRect[] = [];
	for (let y = 0; ; y += step) {
		if (y + tileHeight >= height) {
			rects.push({ x: 0, y: height - tileHeight, width, height: tileHeight });
			break;
		}
		rects.push({ x: 0, y, width, height: tileHeight });
	}
	return rects;
}
