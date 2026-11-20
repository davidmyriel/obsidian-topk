import type { PageKind } from '../topk/client';

// Links and note text for search results. No obsidian import, so it is unit-testable.

export interface ResolvedResult {
	path: string;
	page: number;
	kind: PageKind;
	score: number;
	contentHash: string;
	/** Moved up because the file name contains the words of a short query (nameMatch.ts). */
	nameMatch?: boolean;
	/** The page's text contains the query's exact terms and phrases (ADR-006). */
	exactMatch?: boolean;
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

/**
 * A link to a note result, at its heading when the heading can be part of a link (ADR-007).
 * Names with `#` get an obsidian://open link (no heading), names with `|` or brackets a Markdown
 * link, as for pages (beta 1 F7).
 */
export function noteResultLink(note: { path: string; heading: string }, vaultName: string): string {
	const label = escapeLabel(fileName(note.path).replace(/\.md$/i, ''));
	const heading = note.heading && !/[[\]|#^]/.test(note.heading) ? note.heading : '';
	if (note.path.includes('#')) {
		return `[${label}](obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(note.path)})`;
	}
	if (!/[|[\]]/.test(note.path)) {
		return `[[${note.path.replace(/\.md$/i, '')}${heading ? `#${heading}` : ''}]]`;
	}
	const encoded = note.path
		.split('/')
		.map((segment) => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
		.join('/');
	return `[${label}](${encoded}${heading ? `#${encodeURIComponent(heading)}` : ''})`;
}

/** Note body listing results as links, best first: notes (if any), then pages. */
export function resultsNote(
	query: string,
	results: ResolvedResult[],
	date: Date,
	vaultName: string,
	notes: { path: string; heading: string }[] = [],
): string {
	const pages = results.map(
		(r, i) =>
			`${i + 1}. ${noteLink(r, vaultName)}${r.kind === 'pdf_page' ? ` (page ${r.page})` : ''}`,
	);
	const lines = [
		`# Visual search: ${query}`,
		'',
		`Searched ${date.toISOString().slice(0, 10)} with TopK Visual Search.`,
		'',
		...(notes.length > 0
			? [
					'## Notes',
					'',
					...notes.map((n, i) => `${i + 1}. ${noteResultLink(n, vaultName)}`),
					'',
					...(pages.length > 0 ? ['## Pages', ''] : []),
				]
			: []),
		...pages,
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
