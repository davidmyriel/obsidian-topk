// The hero image for the write-up: one query, each setup's top three pages side by side, with
// the correct page outlined in green. Reads bench/report/results.json from npm run bench.
//
//   npm run bench:hero [-- --query v04 --top 3]   writes bench/report/hero-<query>.png
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { loadNodePdfJs, nodeDocumentOptions } from '../tests/support/node-render';
import { BENCH, CORPUS_DIR } from './corpus';
import type { PageRef } from './metrics';
import { readQueries } from './queries';

interface Result {
	id: string;
	label: string;
	queries: { id: string; top: PageRef[] }[];
}

const THUMB_W = 360;
const THUMB_H = 270;
const PAD = 24;
const LABEL_W = 260;
const HEADER_H = 96;

type PdfJs = {
	getDocument(src: object): {
		promise: Promise<{
			getPage(n: number): Promise<{
				getViewport(o: { scale: number }): { width: number; height: number };
				render(o: { canvasContext: unknown; viewport: unknown }): {
					promise: Promise<void>;
				};
			}>;
		}>;
		destroy(): Promise<void>;
	};
};

async function renderPage(pdfjs: PdfJs, ref: PageRef): Promise<Canvas> {
	const task = pdfjs.getDocument({
		data: new Uint8Array(readFileSync(join(CORPUS_DIR, ref.file))),
		...nodeDocumentOptions,
		verbosity: 0,
	});
	try {
		const page = await (await task.promise).getPage(ref.page);
		const v1 = page.getViewport({ scale: 1 });
		const scale = Math.min((THUMB_W * 2) / v1.width, (THUMB_H * 2) / v1.height);
		const vp = page.getViewport({ scale });
		const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: ctx, viewport: vp }).promise;
		return canvas;
	} finally {
		await task.destroy();
	}
}

function wrap(ctx: SKRSContext2D, text: string, x: number, y: number, width: number, lh: number) {
	let line = '';
	for (const word of text.split(' ')) {
		const next = line ? `${line} ${word}` : word;
		if (ctx.measureText(next).width > width && line) {
			ctx.fillText(line, x, y);
			line = word;
			y += lh;
		} else line = next;
	}
	if (line) ctx.fillText(line, x, y);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			query: { type: 'string', default: 'v04' },
			top: { type: 'string', default: '3' },
		},
	});
	const top = Number(values.top);
	const query = readQueries().find((q) => q.id === values.query);
	if (!query) throw new Error(`no query ${values.query}`);
	const results = JSON.parse(
		readFileSync(join(BENCH, 'report', 'results.json'), 'utf8'),
	) as Result[];
	const pdfjs = (await loadNodePdfJs()) as unknown as PdfJs;
	const rowH = THUMB_H + PAD * 2;
	const W = LABEL_W + top * (THUMB_W + PAD) + PAD;
	const H = HEADER_H + results.length * rowH + PAD;
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#f6f7f9';
	ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = '#111';
	ctx.font = '600 30px sans-serif';
	ctx.fillText(`“${query.query}”`, PAD, 50);
	ctx.font = '18px sans-serif';
	ctx.fillStyle = '#555';
	ctx.fillText(`Top ${top} pages from each setup. Green: the page the query describes.`, PAD, 80);
	const correct = (r: PageRef): boolean =>
		query.answers.some(
			(a) => a.file === r.file && (r.pages ?? [r.page]).some((p) => a.pages.includes(p)),
		);
	for (const [i, result] of results.entries()) {
		const y = HEADER_H + i * rowH;
		ctx.fillStyle = '#111';
		ctx.font = '600 20px sans-serif';
		wrap(ctx, result.label, PAD, y + PAD + 30, LABEL_W - PAD * 2, 26);
		const hits = result.queries.find((q) => q.id === query.id)?.top.slice(0, top) ?? [];
		for (const [j, ref] of hits.entries()) {
			const x = LABEL_W + j * (THUMB_W + PAD);
			const page = await renderPage(pdfjs, ref);
			const s = Math.min(THUMB_W / page.width, THUMB_H / page.height);
			const w = page.width * s;
			const h = page.height * s;
			const ox = x + (THUMB_W - w) / 2;
			const oy = y + PAD + (THUMB_H - h) / 2;
			ctx.fillStyle = '#fff';
			ctx.fillRect(x, y + PAD, THUMB_W, THUMB_H);
			ctx.drawImage(page, ox, oy, w, h);
			ctx.lineWidth = correct(ref) ? 8 : 2;
			ctx.strokeStyle = correct(ref) ? '#1f9d55' : '#c9ced6';
			ctx.strokeRect(x, y + PAD, THUMB_W, THUMB_H);
		}
		if (hits.length === 0) {
			ctx.fillStyle = '#888';
			ctx.font = '18px sans-serif';
			ctx.fillText('no results', LABEL_W, y + PAD + THUMB_H / 2);
		}
	}
	const out = join(BENCH, 'report', `hero-${query.id}.png`);
	writeFileSync(out, await canvas.encode('png'));
	console.log(`wrote ${out}`);
}

await main();
