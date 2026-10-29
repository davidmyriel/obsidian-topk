import type { PageKind } from '../topk/client';

// Links and note text for search results. No obsidian import, so it is unit-testable.

export interface ResolvedResult {
	path: string;
	page: number;
	kind: PageKind;
	score: number;
	contentHash: string;
}

/** Link text that opens a PDF at its page, e.g. "Talks/talk.pdf#page=15". Images link to the file. */
export function pageLinkText(path: string, page: number, kind: PageKind): string {
	return kind === 'pdf_page' ? `${path}#page=${page}` : path;
}

/** A wikilink such as [[Talks/talk.pdf#page=15]]. */
export function wikiLink(result: Pick<ResolvedResult, 'path' | 'page' | 'kind'>): string {
	return `[[${pageLinkText(result.path, result.page, result.kind)}]]`;
}

/** Display name: file name without folders. */
export function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** Note body listing results as links, best first. */
export function resultsNote(query: string, results: ResolvedResult[], date: Date): string {
	const lines = [
		`# Visual search: ${query}`,
		'',
		`Searched ${date.toISOString().slice(0, 10)} with TopK Visual Search.`,
		'',
		...results.map(
			(r, i) => `${i + 1}. ${wikiLink(r)}${r.kind === 'pdf_page' ? ` (page ${r.page})` : ''}`,
		),
		'',
	];
	return lines.join('\n');
}

/** A safe note file name for a query, without extension. */
export function noteBaseName(query: string): string {
	const cleaned = query
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60)
		.trim();
	return `Visual search - ${cleaned || 'results'}`;
}
