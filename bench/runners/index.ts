// npm run bench [-- --setup bm25,topk]
//
// Runs every query in bench/queries.jsonl through each setup and writes bench/report/: report.md,
// results.json and recall.svg. Needs the corpus (npm run bench:fetch). The TopK setup needs
// TOPK_API_KEY (environment or the git-ignored .env); without it, it is skipped.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH, CORPUS_DIR, readCorpus } from '../corpus';
import {
	bootstrapCi,
	recallAt,
	reciprocalRank,
	score,
	type PageRef,
	type Scores,
} from '../metrics';
import { readQueries, type Query } from '../queries';
import { bm25Setup } from './bm25';
import { topkSetup } from './topk';
import { loadDotEnv, type IndexStats, type Setup } from './types';

const K = 10;
const REPORT = join(BENCH, 'report');

interface QueryResult {
	id: string;
	/** Rank of the first correct page, or null when it is not in the top k. */
	rank: number | null;
	top: PageRef[];
}

interface SetupResult {
	id: string;
	label: string;
	stats: IndexStats;
	queries: QueryResult[];
}

async function runSetup(setup: Setup, files: string[], queries: Query[]): Promise<SetupResult> {
	console.log(`[${setup.id}] indexing ${files.length} files …`);
	const stats = await setup.index(files);
	console.log(`[${setup.id}] indexed ${stats.pages} pages in ${stats.seconds.toFixed(1)} s`);
	const out: QueryResult[] = [];
	for (const q of queries) {
		const top = await setup.search(q.query, K);
		const rr = reciprocalRank(top, q.answers);
		out.push({ id: q.id, rank: rr > 0 ? Math.round(1 / rr) : null, top });
	}
	await setup.close?.();
	return { id: setup.id, label: setup.label, stats, queries: out };
}

type TierScores = Scores & { recall1Ci: [number, number]; recall5Ci: [number, number] };

/** Scores of one setup over a subset of queries, with 95% bootstrap ranges for Recall@1 and @5. */
function scoresFor(r: SetupResult, queries: Query[]): TierScores {
	const byId = new Map(r.queries.map((x) => [x.id, x]));
	const runs = queries.map((q) => ({ results: byId.get(q.id)?.top ?? [], relevant: q.answers }));
	return {
		...score(runs),
		recall1Ci: bootstrapCi(runs.map((x) => recallAt(x.results, x.relevant, 1))),
		recall5Ci: bootstrapCi(runs.map((x) => recallAt(x.results, x.relevant, 5))),
	};
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => v.toFixed(2);
const range = ([lo, hi]: [number, number]): string =>
	`<sub>${Math.round(lo * 100)}–${Math.round(hi * 100)}</sub>`;

const TIERS: { id: Query['tier']; title: string; about: string }[] = [
	{
		id: 'specific',
		title: 'Specific queries',
		about: "Written while looking at the page; they name the page's most distinctive details.",
	},
	{
		id: 'vague',
		title: 'Vague queries',
		about: 'The same targets as a half-remembered description of 3–8 words, with no colours, numbers or names. Several pages can fit a vague query, but only the original page counts, so these scores are a lower bound.',
	},
];

function report(results: SetupResult[], queries: Query[], skipped: string[]): string {
	const labelled = queries.filter((q) => q.status === 'labelled').length;
	const categories = [...new Set(queries.map((q) => q.category))];
	const pages = readCorpus().files.reduce((n, f) => n + (f.pages ?? 0), 0);
	const lines: string[] = [
		'# Benchmark report',
		'',
		`${queries.length} queries over ${readCorpus().files.length} files (${pages.toLocaleString('en-US')} pages). ${new Date().toISOString().slice(0, 10)}.`,
		'',
		labelled === queries.length
			? 'All answers are labelled by two people.'
			: `**Answers are drafts** (${labelled} of ${queries.length} labelled). Claude wrote the queries and answers from rendered pages and checked them for look-alikes. They are not yet labelled independently by two people (PLAN.md), and their author knew which systems were being tested.`,
		'',
		'The small numbers after each recall figure are its 95% bootstrap range over queries.',
		'',
		'| Setup | Index time | Cost per 1,000 pages |',
		'| --- | ---: | ---: |',
		...results.map(
			(r) =>
				`| ${r.label} | ${Math.round(r.stats.seconds)} s | $${((r.stats.costUsd / Math.max(1, r.stats.pages)) * 1000).toFixed(3)} |`,
		),
		'',
		'![Recall@1 by setup and query tier](recall.svg)',
		'',
	];
	for (const tier of TIERS) {
		const qs = queries.filter((q) => q.tier === tier.id);
		if (qs.length === 0) continue;
		lines.push(
			`## ${tier.title} (${qs.length})`,
			'',
			tier.about,
			'',
			'| Setup | Recall@1 | Recall@5 | nDCG@10 | MRR |',
			'| --- | ---: | ---: | ---: | ---: |',
			...results.map((r) => {
				const s = scoresFor(r, qs);
				return `| ${r.label} | ${pct(s.recall1)} ${range(s.recall1Ci)} | ${pct(s.recall5)} ${range(s.recall5Ci)} | ${num(s.ndcg10)} | ${num(s.mrr)} |`;
			}),
			'',
			'Recall@1 / Recall@5 by category:',
			'',
			`| Category | Queries | ${results.map((r) => r.id).join(' | ')} |`,
			`| --- | ---: | ${results.map(() => '---:').join(' | ')} |`,
			...categories.map((c) => {
				const cq = qs.filter((q) => q.category === c);
				const cells = results.map((r) => {
					const s = scoresFor(r, cq);
					return `${pct(s.recall1)} / ${pct(s.recall5)}`;
				});
				return `| ${c} | ${cq.length} | ${cells.join(' | ')} |`;
			}),
			'',
		);
	}
	lines.push(
		'## Per query (rank of the correct page; – means not in the top 10)',
		'',
		`| Query | Tier | Category | ${results.map((r) => r.id).join(' | ')} |`,
		`| --- | --- | --- | ${results.map(() => '---:').join(' | ')} |`,
		...queries.map((q) => {
			const cells = results.map((r) => r.queries.find((x) => x.id === q.id)?.rank ?? '–');
			return `| ${q.id}: ${q.query} | ${q.tier} | ${q.category} | ${cells.join(' | ')} |`;
		}),
		'',
		'## Notes',
		'',
		...results.flatMap((r) => r.stats.notes.map((n) => `- ${r.id}: ${n}`)),
		...skipped.map((s) => `- ${s}`),
		'',
	);
	return lines.join('\n');
}

/** Bars of Recall@1 per setup, one bar per query tier. */
function recallSvg(results: SetupResult[], queries: Query[]): string {
	const W = 640;
	const H = 300;
	const left = 48;
	const bottom = 230;
	const top = 36;
	const tiers = TIERS.filter((t) => queries.some((q) => q.tier === t.id));
	const colors = ['#2f6fde', '#9bbcf5'];
	const group = (W - left - 20) / Math.max(1, results.length);
	const bar = Math.min(60, group / (tiers.length + 1));
	const y = (v: number): number => bottom - v * (bottom - top);
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
		`<rect width="${W}" height="${H}" fill="#fff"/>`,
		`<text x="${left}" y="18" font-weight="600">Recall@1</text>`,
	];
	for (const t of [0, 0.25, 0.5, 0.75, 1]) {
		parts.push(
			`<line x1="${left}" x2="${W - 20}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e5e5"/>`,
			`<text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" fill="#666">${t * 100}%</text>`,
		);
	}
	results.forEach((r, i) => {
		const width = tiers.length * bar + (tiers.length - 1) * 6;
		const x0 = left + i * group + (group - width) / 2;
		tiers.forEach((tier, j) => {
			const v = scoresFor(
				r,
				queries.filter((q) => q.tier === tier.id),
			).recall1;
			const x = x0 + j * (bar + 6);
			parts.push(
				`<rect x="${x}" y="${y(v)}" width="${bar}" height="${bottom - y(v)}" fill="${colors[j % colors.length] ?? '#999'}"/>`,
				`<text x="${x + bar / 2}" y="${y(v) - 4}" text-anchor="middle">${Math.round(v * 100)}%</text>`,
				`<text x="${x + bar / 2}" y="${bottom + 14}" text-anchor="middle" fill="#666">${tier.id}</text>`,
			);
		});
		parts.push(
			`<text x="${left + i * group + group / 2}" y="${bottom + 34}" text-anchor="middle" font-weight="600">${r.id}</text>`,
		);
	});
	parts.push('</svg>');
	return parts.join('\n');
}

async function main(): Promise<void> {
	loadDotEnv();
	const { values } = parseArgs({ options: { setup: { type: 'string', default: 'bm25,topk' } } });
	const wanted = new Set(values.setup.split(','));
	const files = readCorpus().files.map((f) => f.file);
	const missing = files.filter((f) => !existsSync(join(CORPUS_DIR, f)));
	if (missing.length > 0)
		throw new Error(`${missing.length} corpus files missing; run npm run bench:fetch`);
	const queries = readQueries();
	mkdirSync(REPORT, { recursive: true });
	const skipped: string[] = [];
	const setups: Setup[] = [];
	if (wanted.has('bm25')) setups.push(bm25Setup());
	if (wanted.has('topk')) {
		const s = topkSetup();
		if (s) setups.push(s);
		else skipped.push('topk: skipped, TOPK_API_KEY is not set.');
	}
	skipped.push(
		'Gemini Embedding 2 (6-page and 1-page chunks, PLAN.md): not run yet; needs a Gemini API key.',
	);
	const results: SetupResult[] = [];
	for (const setup of setups) results.push(await runSetup(setup, files, queries));
	writeFileSync(join(REPORT, 'results.json'), JSON.stringify(results, null, 2));
	writeFileSync(join(REPORT, 'recall.svg'), recallSvg(results, queries));
	const md = report(results, queries, skipped);
	writeFileSync(join(REPORT, 'report.md'), md);
	console.log(md.split('## Per query')[0]);
}

await main();
