// Blind labelling for bench/queries.jsonl (PLAN.md Stage 3: two people label independently).
//
//   npm run bench:labels -- sheet           write bench/labels/sheet.md: queries only, no answers
//   npm run bench:labels -- compare A B     compare bench/labels/A.json and B.json with each
//                                           other and with the drafted answers
//
// A label file maps query id to the answer the labeller found, without looking at the draft:
//   { "q01": { "file": "papers/…pdf", "pages": [7] }, "q02": null, … }   (null: no page matches)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH } from './corpus';
import { readQueries, type Answer, type Query } from './queries';

const LABELS = join(BENCH, 'labels');

type Labels = Record<string, Answer | null>;

const key = (a: Answer | null | undefined): string =>
	a ? `${a.file}#${[...a.pages].sort((x, y) => x - y).join(',')}` : 'none';

/** True when two answers name the same file and share at least one page. */
export function overlaps(a: Answer | null | undefined, b: Answer | null | undefined): boolean {
	if (!a || !b) return !a && !b;
	return a.file === b.file && a.pages.some((p) => b.pages.includes(p));
}

function sheet(queries: Query[]): void {
	mkdirSync(LABELS, { recursive: true });
	const lines = [
		'# Labelling sheet',
		'',
		'For each query, find the page in the corpus (`npm run bench:fetch`) that best answers it,',
		'without looking at `queries.jsonl`. Record it in `bench/labels/<your initials>.json` as',
		'`"q01": { "file": "papers/….pdf", "pages": [7] }`, or `null` if nothing matches. Pages are',
		'1-based PDF page numbers, not the numbers printed on the page.',
		'',
		...queries.map((q) => `- **${q.id}** (${q.category}): ${q.query}`),
		'',
	];
	writeFileSync(join(LABELS, 'sheet.md'), lines.join('\n'));
	console.log(`wrote bench/labels/sheet.md with ${queries.length} queries`);
}

function compare(queries: Query[], a: string, b: string): void {
	const read = (name: string): Labels =>
		JSON.parse(readFileSync(join(LABELS, `${name}.json`), 'utf8')) as Labels;
	const la = read(a);
	const lb = read(b);
	let agree = 0;
	const rows: string[] = [];
	for (const q of queries) {
		const x = la[q.id];
		const y = lb[q.id];
		const draft = q.answers[0];
		if (overlaps(x, y)) agree++;
		else rows.push(`| ${q.id} | ${key(x)} | ${key(y)} | ${key(draft)} |`);
	}
	const report = [
		`# Label comparison: ${a} vs ${b}`,
		'',
		`${agree} of ${queries.length} agree (same file, at least one shared page).`,
		'',
		...(rows.length > 0
			? [`| id | ${a} | ${b} | draft |`, '| --- | --- | --- | --- |', ...rows, '']
			: []),
	].join('\n');
	writeFileSync(join(LABELS, 'comparison.md'), report);
	console.log(report);
}

const [command, a, b] = process.argv.slice(2);
const queries = readQueries();
if (command === 'sheet') sheet(queries);
else if (command === 'compare' && a && b) compare(queries, a, b);
else {
	console.error('usage: bench:labels -- sheet | compare <A> <B>');
	process.exitCode = 1;
}
