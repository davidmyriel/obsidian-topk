// Spike C: time and memory for rendering PDF pages in Node at one long-side resolution.
// Run once per resolution so each run has its own process and peak RSS:
//   npx tsx scripts/spike-c-render.ts <file.pdf> <longSide> [maxPages]
import { readFileSync } from 'node:fs';
import { renderPdfPages } from '../src/render/pdfRenderer';
import {
	loadNodePdfJs,
	nodeCanvasFactory,
	nodeDocumentOptions,
} from '../tests/support/node-render';

const [file, longSideArg, maxPagesArg] = process.argv.slice(2);
if (!file || !longSideArg) {
	console.error('usage: spike-c-render.ts <file.pdf> <longSide> [maxPages]');
	process.exit(2);
}
const longSide = Number(longSideArg);
const pdfjs = await loadNodePdfJs();
const data = new Uint8Array(readFileSync(file));

let peakRss = 0;
const sample = (): void => {
	peakRss = Math.max(peakRss, process.memoryUsage().rss);
};
const timer = setInterval(sample, 5);
const baseRss = process.memoryUsage().rss;

const pages: { render: number; encode: number; bytes: number; quality: number }[] = [];
for await (const p of renderPdfPages(pdfjs, data, nodeCanvasFactory, {
	longSide,
	format: 'jpeg',
	quality: 0.85,
	maxBytes: 512 * 1024,
	documentOptions: nodeDocumentOptions,
	...(maxPagesArg ? { maxPages: Number(maxPagesArg) } : {}),
})) {
	sample();
	pages.push({
		render: p.renderMs,
		encode: p.encodeMs,
		bytes: p.bytes.length,
		quality: p.quality,
	});
}
clearInterval(timer);

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const max = (xs: number[]): number => Math.max(...xs);
const mb = (n: number): string => (n / 1024 / 1024).toFixed(0);
console.log(
	JSON.stringify({
		file: file.split('/').pop(),
		longSide,
		pages: pages.length,
		renderMsAvg: Math.round(avg(pages.map((p) => p.render))),
		encodeMsAvg: Math.round(avg(pages.map((p) => p.encode))),
		totalMsPerPage: Math.round(avg(pages.map((p) => p.render + p.encode))),
		jpegKbAvg: Math.round(avg(pages.map((p) => p.bytes)) / 1024),
		jpegKbMax: Math.round(max(pages.map((p) => p.bytes)) / 1024),
		minQuality: Math.min(...pages.map((p) => p.quality)),
		baseRssMb: mb(baseRss),
		peakRssMb: mb(peakRss),
	}),
);
