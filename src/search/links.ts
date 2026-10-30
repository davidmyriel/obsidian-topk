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

/**
 * A link for a note (beta 1 F7). Ordinary names get a wikilink such as [[Talks/talk.pdf#page=15]].
 * Inside a wikilink `|` starts an alias, so names with `|` or brackets get a Markdown link with the
 * path percent-encoded. No Obsidian link form can contain `#` (it always starts a heading or page,
 * checked in Obsidian 1.14), so those names get an obsidian://open link, which opens the file but
 * not a page; the page number stays in the note text.
 */
export function noteLink(
	result: Pick<ResolvedResult, 'path' | 'page' | 'kind'>,
	vaultName: string,
): string {
	const subpath = result.kind === 'pdf_page' ? `#page=${result.page}` : '';
	const label = escapeLabel(
		result.kind === 'pdf_page'
			? `${fileName(result.path)}, page ${result.page}`
			: fileName(result.path),
	);
	if (result.path.includes('#')) {
		return `[${label}](obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(result.path)})`;
	}
	if (!/[|[\]]/.test(result.path)) return `[[${result.path}${subpath}]]`;
	const encoded = result.path
		.split('/')
		.map((segment) => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
		.join('/');
	return `[${label}](${encoded}${subpath})`;
}

const escapeLabel = (text: string): string => text.replace(/[[\]]/g, '\\$&');

/** Display name: file name without folders. */
export function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** Note body listing results as links, best first. */
export function resultsNote(
	query: string,
	results: ResolvedResult[],
	date: Date,
	vaultName: string,
): string {
	const lines = [
		`# Visual search: ${query}`,
		'',
		`Searched ${date.toISOString().slice(0, 10)} with TopK Visual Search.`,
		'',
		...results.map(
			(r, i) =>
				`${i + 1}. ${noteLink(r, vaultName)}${r.kind === 'pdf_page' ? ` (page ${r.page})` : ''}`,
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
