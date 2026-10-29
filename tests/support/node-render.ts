// Node implementations of the renderer's injected dependencies, for tests and scripts.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { CanvasFactory, PdfJsLike } from '../../src/render/pdfRenderer';

export async function loadNodePdfJs(): Promise<PdfJsLike> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	return pdfjs as unknown as PdfJsLike;
}

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/** getDocument options pdf.js needs in Node to find its bundled standard fonts. */
export const nodeDocumentOptions = {
	standardFontDataUrl: join(pdfjsRoot, 'standard_fonts') + '/',
};

export const nodeCanvasFactory: CanvasFactory = (width, height) => {
	const canvas = createCanvas(width, height);
	const context = canvas.getContext('2d');
	// Pages without a background would encode as black in JPEG.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, width, height);
	return {
		canvas,
		context,
		encode: async (format, quality) =>
			format === 'png'
				? new Uint8Array(await canvas.encode('png'))
				: new Uint8Array(await canvas.encode('jpeg', Math.round(quality * 100))),
		release: () => {
			canvas.width = 0;
			canvas.height = 0;
		},
	};
};
