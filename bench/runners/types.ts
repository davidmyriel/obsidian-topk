// What every benchmark setup implements, plus shared helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadNodePdfJs, nodeDocumentOptions } from '../../tests/support/node-render';
import { BENCH } from '../corpus';
import type { PageRef } from '../metrics';

export interface IndexStats {
	/** Wall-clock seconds to build the index from the corpus files. */
	seconds: number;
	pages: number;
	/** Dollar cost to index, or 0 for local setups. */
	costUsd: number;
	notes: string[];
}

export interface Setup {
	id: string;
	/** What the setup reproduces, for the report. */
	label: string;
	index(files: string[]): Promise<IndexStats>;
	/** Best first; at most k pages. */
	search(query: string, k: number): Promise<PageRef[]>;
	close?(): Promise<void> | void;
}

/** Reads KEY=value lines from the git-ignored .env at the repo root into process.env. */
export function loadDotEnv(): void {
	const path = join(BENCH, '..', '.env');
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (m?.[1] && m[2] !== undefined && process.env[m[1]] === undefined) {
			process.env[m[1]] = m[2];
		}
	}
}

/** The text pdf.js extracts from each page, as Obsidian's Text Extractor does for PDFs. */
export async function pdfPageTexts(data: Uint8Array): Promise<string[]> {
	const pdfjs = (await loadNodePdfJs()) as unknown as {
		getDocument(src: object): {
			destroy(): Promise<void>;
			promise: Promise<{
				numPages: number;
				getPage(n: number): Promise<{
					getTextContent(): Promise<{ items: { str?: string }[] }>;
					cleanup(): void;
				}>;
			}>;
		};
	};
	const task = pdfjs.getDocument({ data, ...nodeDocumentOptions, verbosity: 0 });
	const doc = await task.promise;
	const out: string[] = [];
	try {
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			out.push(
				content.items
					.map((i) => i.str ?? '')
					.join(' ')
					.replace(/\s+/g, ' ')
					.trim(),
			);
			page.cleanup();
		}
	} finally {
		await task.destroy();
	}
	return out;
}
