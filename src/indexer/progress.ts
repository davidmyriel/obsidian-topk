import type { IndexProgress, IndexSummary } from './indexer';

const n = (value: number): string => value.toLocaleString('en-US');
const count = (value: number, word: string): string =>
	`${n(value)} ${word}${value === 1 ? '' : 's'}`;

/** Status bar text, e.g. "Indexing 214 / 1,032 pages". */
export function progressText(p: IndexProgress): string {
	return p.phase === 'scanning'
		? `Scanning ${n(p.done)} / ${n(p.total)} files`
		: `Indexing ${n(p.done)} / ${n(p.total)} pages`;
}

/** One-line result for a notice. */
export function summaryText(s: IndexSummary): string {
	const parts: string[] = [];
	if (s.cancelled) parts.push('Indexing cancelled');
	else if (s.pagesUploaded === 0 && s.pagesDeleted === 0 && s.failed.length === 0) {
		parts.push('Index is up to date');
	} else parts.push('Indexing finished');
	if (s.pagesUploaded > 0)
		parts.push(
			`${count(s.pagesUploaded, 'page')} from ${count(s.filesIndexed, 'file')} uploaded`,
		);
	if (s.pagesDeleted > 0) parts.push(`${count(s.pagesDeleted, 'page')} removed`);
	if (s.filesUnchanged > 0) parts.push(`${n(s.filesUnchanged)} unchanged`);
	if (s.skipped.length > 0) parts.push(`${n(s.skipped.length)} skipped`);
	if (s.failed.length > 0) parts.push(`${n(s.failed.length)} failed`);
	return `${parts.join(', ')}.`;
}
