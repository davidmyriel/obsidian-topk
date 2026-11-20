// OCR + BM25: what Omnisearch with Text Extractor does for PDFs. Text Extractor returns the text
// layer pdf.js extracts (it runs Tesseract only on images, and the corpus is all PDFs), and
// Omnisearch ranks with MiniSearch (BM25), boosting file names. Here each page is its own
// document, which gives the baseline page-level results it would not otherwise have.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MiniSearch from 'minisearch';
import { CORPUS_DIR } from '../corpus';
import type { PageRef } from '../metrics';
import { pdfPageTexts, type IndexStats, type Setup } from './types';

interface PageDoc {
	id: string;
	file: string;
	page: number;
	name: string;
	text: string;
}

export function bm25Setup(): Setup {
	const index = new MiniSearch<PageDoc>({
		fields: ['name', 'text'],
		storeFields: ['file', 'page'],
		searchOptions: { boost: { name: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'OR' },
	});
	return {
		id: 'bm25',
		label: 'Text layer + BM25 (Omnisearch with Text Extractor)',
		async index(files: string[]): Promise<IndexStats> {
			const started = performance.now();
			let pages = 0;
			let empty = 0;
			for (const file of files) {
				const texts = await pdfPageTexts(
					new Uint8Array(readFileSync(join(CORPUS_DIR, file))),
				);
				const name = file.slice(file.lastIndexOf('/') + 1, -4).replace(/-/g, ' ');
				index.addAll(
					texts.map((text, i) => ({
						id: `${file}#${i + 1}`,
						file,
						page: i + 1,
						name,
						text,
					})),
				);
				pages += texts.length;
				empty += texts.filter((t) => t.length < 20).length;
			}
			return {
				seconds: (performance.now() - started) / 1000,
				pages,
				costUsd: 0,
				notes: [`${empty} pages have almost no text layer (under 20 characters).`],
			};
		},
		search(query: string, k: number): Promise<PageRef[]> {
			return Promise.resolve(
				index
					.search(query)
					.slice(0, k)
					.map((r) => ({ file: r.file as string, page: r.page as number })),
			);
		},
	};
}
