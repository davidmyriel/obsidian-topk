import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { imageSize } from '../../src/render/imageSize';
import { countPages } from '../../src/render/pageSource';
import { tileRects } from '../../src/render/tiles';
import { nodeRenderEnv } from '../support/nodeVault';

const encode = (w: number, h: number, format: 'png' | 'jpeg' | 'webp'): Uint8Array => {
	const c = createCanvas(w, h);
	c.getContext('2d').fillRect(0, 0, w, h);
	return new Uint8Array(format === 'png' ? c.encodeSync('png') : c.encodeSync(format, 80));
};

describe('imageSize (F6)', () => {
	it.each(['png', 'jpeg', 'webp'] as const)('reads %s dimensions from the header', (format) => {
		expect(imageSize(encode(321, 1234, format))).toEqual({ width: 321, height: 1234 });
	});

	it('returns null for anything else', () => {
		expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
		expect(imageSize(new Uint8Array(0))).toBeNull();
	});

	it('counts one page per tile for tall images', async () => {
		const tall = encode(400, 9000, 'png');
		expect(await countPages(nodeRenderEnv, 'image', tall)).toBe(tileRects(400, 9000).length);
		expect(await countPages(nodeRenderEnv, 'image', encode(800, 600, 'jpeg'))).toBe(1);
	});
});
