// Page-level retrieval metrics. A result is relevant when it names a labelled file and page.

export interface PageRef {
	file: string;
	page: number;
	/** For a multi-page result (a chunk): every page it covers. It is correct if any one is. */
	pages?: number[];
}

export interface Relevant {
	file: string;
	pages: number[];
}

const hit = (r: PageRef, relevant: Relevant[]): boolean =>
	relevant.some(
		(a) => a.file === r.file && (r.pages ?? [r.page]).some((p) => a.pages.includes(p)),
	);

/** Distinct relevant pages, so a two-page answer counts as two relevant items. */
const relevantCount = (relevant: Relevant[]): number =>
	relevant.reduce((n, a) => n + new Set(a.pages).size, 0);

/** 1 when any relevant page is in the top k, else 0. */
export function recallAt(results: PageRef[], relevant: Relevant[], k: number): number {
	return results.slice(0, k).some((r) => hit(r, relevant)) ? 1 : 0;
}

/** Reciprocal rank of the first relevant page; 0 when none is returned. */
export function reciprocalRank(results: PageRef[], relevant: Relevant[]): number {
	const i = results.findIndex((r) => hit(r, relevant));
	return i < 0 ? 0 : 1 / (i + 1);
}

/** nDCG@k with binary relevance; each relevant page counts once. */
export function ndcgAt(results: PageRef[], relevant: Relevant[], k: number): number {
	const seen = new Set<string>();
	let dcg = 0;
	for (const [i, r] of results.slice(0, k).entries()) {
		const key = `${r.file}#${r.page}`;
		if (seen.has(key) || !hit(r, relevant)) continue;
		seen.add(key);
		dcg += 1 / Math.log2(i + 2);
	}
	let ideal = 0;
	for (let i = 0; i < Math.min(k, relevantCount(relevant)); i++) ideal += 1 / Math.log2(i + 2);
	return ideal === 0 ? 0 : dcg / ideal;
}

export interface Scores {
	queries: number;
	recall1: number;
	recall5: number;
	ndcg10: number;
	mrr: number;
}

/**
 * 95% percentile bootstrap range of the mean of per-query values. Seeded, so reports are
 * reproducible.
 */
export function bootstrapCi(values: number[], samples = 2000, seed = 1): [number, number] {
	if (values.length === 0) return [0, 0];
	let state = seed >>> 0;
	const random = (): number => {
		// mulberry32
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const means: number[] = [];
	for (let i = 0; i < samples; i++) {
		let sum = 0;
		for (let j = 0; j < values.length; j++) {
			sum += values[Math.floor(random() * values.length)] ?? 0;
		}
		means.push(sum / values.length);
	}
	means.sort((a, b) => a - b);
	return [means[Math.floor(0.025 * samples)] ?? 0, means[Math.ceil(0.975 * samples) - 1] ?? 0];
}

/** Mean of each metric over a set of queries. */
export function score(runs: { results: PageRef[]; relevant: Relevant[] }[]): Scores {
	const mean = (f: (r: (typeof runs)[number]) => number): number =>
		runs.length === 0 ? 0 : runs.reduce((s, r) => s + f(r), 0) / runs.length;
	return {
		queries: runs.length,
		recall1: mean((r) => recallAt(r.results, r.relevant, 1)),
		recall5: mean((r) => recallAt(r.results, r.relevant, 5)),
		ndcg10: mean((r) => ndcgAt(r.results, r.relevant, 10)),
		mrr: mean((r) => reciprocalRank(r.results, r.relevant)),
	};
}
