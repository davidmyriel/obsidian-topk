import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPdfPages, type RenderedPage } from '../../src/render/pdfRenderer';
import { loadNodePdfJs, nodeCanvasFactory, nodeDocumentOptions } from '../support/node-render';

const talk = readFileSync(
	join(import.meta.dirname, '..', 'fixtures', 'vault', 'Talks', 'talk.pdf'),
);

async function renderAll(longSide: number): Promise<RenderedPage[]> {
	const pdfjs = await loadNodePdfJs();
	const pages: RenderedPage[] = [];
	for await (const p of renderPdfPages(pdfjs, new Uint8Array(talk), nodeCanvasFactory, {
		longSide,
		format: 'jpeg',
		quality: 0.85,
		maxBytes: 512 * 1024,
		documentOptions: nodeDocumentOptions,
	})) {
		pages.push(p);
	}
	return pages;
}

describe('renderPdfPages with pdfjs-dist', () => {
	it('renders every page of the fixture talk as JPEG at the requested long side', async () => {
		const pages = await renderAll(1024);
		expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
		for (const p of pages) {
			expect(p.width).toBe(1024);
			expect(p.height).toBe(576);
			// JPEG SOI marker.
			expect(Array.from(p.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
			expect(p.bytes.length).toBeLessThan(512 * 1024);
		}
	});

	it('honours maxPages', async () => {
		const pdfjs = await loadNodePdfJs();
		const seen: number[] = [];
		for await (const p of renderPdfPages(pdfjs, new Uint8Array(talk), nodeCanvasFactory, {
			longSide: 512,
			format: 'png',
			quality: 1,
			maxBytes: 512 * 1024,
			maxPages: 2,
			documentOptions: nodeDocumentOptions,
		})) {
			seen.push(p.page);
		}
		expect(seen).toEqual([1, 2]);
	});
});

describe('pixel budget', () => {
	it('renders a 16:9 slide to the model budget without exceeding it', async () => {
		const pdfjs = await loadNodePdfJs();
		for await (const p of renderPdfPages(pdfjs, new Uint8Array(talk), nodeCanvasFactory, {
			maxPixels: 1_310_720,
			format: 'jpeg',
			quality: 0.85,
			maxBytes: 512 * 1024,
			maxPages: 1,
			documentOptions: nodeDocumentOptions,
		})) {
			expect([p.width, p.height]).toEqual([1526, 858]);
			expect(p.width * p.height).toBeLessThanOrEqual(1_310_720);
		}
	});
});
