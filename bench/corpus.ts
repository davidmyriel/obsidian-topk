// The benchmark corpus manifest, bench/corpus.json: every file with its source and licence.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CorpusFile {
	/** Path under bench/corpus/, which is also the vault path used by every setup. */
	file: string;
	url: string;
	sha256?: string;
	bytes?: number;
	/** Pages the plugin indexes: PDF pages, or tiles for a tall image. */
	pages?: number;
	type: 'paper' | 'slides' | 'handwriting' | 'whiteboard' | 'screenshot' | 'chart' | 'scan';
	title: string;
	author: string;
	/** Human-readable page for the file, with its licence. */
	source: string;
	license: string;
	licenseUrl: string;
}

export interface Corpus {
	description: string;
	files: CorpusFile[];
}

export const BENCH = dirname(new URL(import.meta.url).pathname);
export const CORPUS_JSON = join(BENCH, 'corpus.json');
export const CORPUS_DIR = join(BENCH, 'corpus');

export function readCorpus(): Corpus {
	return JSON.parse(readFileSync(CORPUS_JSON, 'utf8')) as Corpus;
}
