import { describe, expect, it } from 'vitest';
import { scaledDimensions, scaleFor } from '../../src/render/pdfRenderer';
import { MODEL_MAX_PIXELS } from '../../src/settingsModel';

describe('render sizing', () => {
	it.each([
		['16:9 slide', 960, 540, [1526, 858]],
		['A4 portrait', 595, 842, [962, 1361]],
		['US Letter', 612, 792, [1006, 1302]],
		['square', 1000, 1000, [1144, 1144]],
	])('fits a %s into the model pixel budget', (_name, w, h, expected) => {
		const dims = scaledDimensions(w, h, scaleFor(w, h, { maxPixels: MODEL_MAX_PIXELS }));
		expect([dims.width, dims.height]).toEqual(expected);
		expect(dims.width * dims.height).toBeLessThanOrEqual(MODEL_MAX_PIXELS);
	});

	it('uses the smaller of a long side and a pixel budget', () => {
		expect(scaleFor(960, 540, { longSide: 1024 })).toBeCloseTo(1024 / 960);
		expect(scaleFor(960, 540, { longSide: 4000, maxPixels: MODEL_MAX_PIXELS })).toBeCloseTo(
			Math.sqrt(MODEL_MAX_PIXELS / (960 * 540)),
		);
		expect(() => scaleFor(1, 1, {})).toThrow();
	});

	it('keeps an exact long side exact despite floating point', () => {
		expect(scaledDimensions(960, 540, 1024 / 960)).toEqual({ width: 1024, height: 576 });
	});
});
