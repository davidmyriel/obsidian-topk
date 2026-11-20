// The benchmark queries, bench/queries.jsonl: one JSON object per line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH } from './corpus';

export interface Answer {
	file: string;
	pages: number[];
}

export interface Query {
	id: string;
	query: string;
	category: 'diagram' | 'chart' | 'table' | 'screenshot' | 'plain_text';
	/** Answer proposed while drafting; replaced by the agreed label once both labellers agree. */
	answers: Answer[];
	status: 'draft' | 'labelled';
	/** specific: names the page's distinctive details; vague: a half-remembered description. */
	tier: 'specific' | 'vague';
	/** For a vague query, the specific query with the same target. */
	of?: string;
}

export const QUERIES_JSONL = join(BENCH, 'queries.jsonl');

export function readQueries(): Query[] {
	return readFileSync(QUERIES_JSONL, 'utf8')
		.split('\n')
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l) as Query);
}
