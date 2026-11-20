// Gemini Embedding 2 over PDF chunks, as LLM Hub does: each chunk of N pages is cut out of the PDF
// and embedded as a PDF; queries are embedded as text and ranked by cosine similarity.
//
// Scoring is lenient to this setup: a chunk is one result, and it counts as the right page when
// it contains that page. A reader of a 6-page chunk still has to find the page inside it.
// Embeddings are cached in bench/report/, so a rerun only embeds the queries.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { BENCH, CORPUS_DIR } from '../corpus';
import type { PageRef } from '../metrics';
import type { IndexStats, Setup } from './types';

const MODEL = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-2';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

/** Gemini API list prices, per million input tokens (ai.google.dev pricing, read 2026-11-20). */
const PRICE_PER_M_TOKENS = { image: 0.45, text: 0.2 };

interface Chunk {
	file: string;
	/** 1-based pages in this chunk. */
	pages: number[];
	vector: number[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function embed(
	apiKey: string,
	part: object,
	taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[]> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
			body: JSON.stringify({ content: { parts: [part] }, taskType }),
		});
		if (res.ok) {
			const body = (await res.json()) as { embedding?: { values?: number[] } };
			const values = body.embedding?.values;
			if (!values) throw new Error('Gemini returned no embedding');
			return values;
		}
		const text = await res.text();
		// The free tier allows 1,000 embed requests per day; retrying will not help until it resets.
		if (res.status === 429 && /PerDay/.test(text)) {
			throw new Error(
				'Gemini free-tier daily quota (1,000 embed requests) is used up; rerun after it resets. Finished embeddings are cached.',
			);
		}
		if ((res.status === 429 || res.status >= 500) && attempt < 8) {
			await sleep(Math.min(60_000, 2 ** attempt * 2000));
			continue;
		}
		throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
	}
}

function normalize(v: number[]): number[] {
	const n = Math.hypot(...v) || 1;
	return v.map((x) => x / n);
}

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export function geminiSetup(pagesPerChunk: number): Setup | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;
	const cachePath = join(BENCH, 'report', `gemini-cache-${MODEL}.json`);
	const cache: Record<string, number[]> = existsSync(cachePath)
		? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, number[]>)
		: {};
	const chunks: Chunk[] = [];
	const saveCache = (): void => writeFileSync(cachePath, JSON.stringify(cache));
	return {
		id: `gemini-${pagesPerChunk}p`,
		label: `Gemini Embedding 2, ${pagesPerChunk}-page chunks (LLM Hub${pagesPerChunk === 1 ? ' at its best setting' : "'s default"})`,
		async index(files: string[]): Promise<IndexStats> {
			// Embedding time is summed across runs, since the free tier's daily quota can split the
			// first index over several days.
			const statsPath = join(BENCH, 'report', `gemini-index-stats-${pagesPerChunk}p.json`);
			let seconds = existsSync(statsPath)
				? (JSON.parse(readFileSync(statsPath, 'utf8')) as { seconds: number }).seconds
				: 0;
			let embedded = 0;
			let pages = 0;
			try {
				for (const file of files) {
					const source = await PDFDocument.load(readFileSync(join(CORPUS_DIR, file)), {
						ignoreEncryption: true,
					});
					const count = source.getPageCount();
					pages += count;
					for (let first = 0; first < count; first += pagesPerChunk) {
						const indices = Array.from(
							{ length: Math.min(pagesPerChunk, count - first) },
							(_, i) => first + i,
						);
						const out = await PDFDocument.create();
						for (const p of await out.copyPages(source, indices)) out.addPage(p);
						const bytes = await out.save();
						const key = `${pagesPerChunk}:${createHash('sha256').update(bytes).digest('hex')}`;
						let vector = cache[key];
						if (!vector) {
							const started = performance.now();
							vector = await embed(
								apiKey,
								{
									inline_data: {
										mime_type: 'application/pdf',
										data: Buffer.from(bytes).toString('base64'),
									},
								},
								'RETRIEVAL_DOCUMENT',
							);
							seconds += (performance.now() - started) / 1000;
							cache[key] = vector;
							embedded++;
							if (embedded % 25 === 0) saveCache();
						}
						chunks.push({
							file,
							pages: indices.map((i) => i + 1),
							vector: normalize(vector),
						});
					}
				}
			} finally {
				saveCache();
				writeFileSync(statsPath, JSON.stringify({ seconds }));
			}
			// Gemini bills a PDF page as an image of about 258 tokens (its documented PDF rate).
			const tokens = pages * 258;
			return {
				seconds,
				pages,
				costUsd: (tokens / 1e6) * PRICE_PER_M_TOKENS.image,
				notes: [
					`${chunks.length} chunks of up to ${pagesPerChunk} pages; ${embedded} embedded this run. Index time is the embedding time, summed across runs.`,
					'Cost assumes 258 tokens per PDF page at the image rate; on the free tier it is $0.',
					...(pagesPerChunk > 1
						? [
								'Scored leniently: a chunk counts as the right page when it contains it, and each chunk is one result.',
							]
						: []),
				],
			};
		},
		async search(query: string, k: number): Promise<PageRef[]> {
			// Query embeddings are cached too, and shared by the 1-page and 6-page setups.
			const key = `query:${query}`;
			let vector = cache[key];
			if (!vector) {
				vector = await embed(apiKey, { text: query }, 'RETRIEVAL_QUERY');
				cache[key] = vector;
				saveCache();
			}
			const q = normalize(vector);
			return chunks
				.map((c) => ({ c, s: dot(q, c.vector) }))
				.sort((a, b) => b.s - a.s)
				.slice(0, k)
				.map(({ c }) => ({ file: c.file, page: c.pages[0] ?? 1, pages: c.pages }));
		},
	};
}
