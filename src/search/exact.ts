// Exact-text search (ADR-006): which parts of a query must appear on the page, and how page text
// is normalised for TopK's keyword index. No obsidian import, so it is unit-testable.

/** Page text above this many characters is cut, to stay well inside TopK's document limits. */
export const MAX_PAGE_TEXT = 100_000;

/** Accents removed (TopK does not fold them, Spike F), so "creme" finds "crème". */
export function foldAccents(text: string): string {
	return text.normalize('NFKD').replace(/\p{M}/gu, '');
}

/**
 * The page text as stored in TopK: accent-folded, whitespace collapsed, words hyphenated at a line
 * break rejoined ("decen- tralized" → "decentralized"), capped.
 */
export function pageTextForIndex(text: string): string | undefined {
	const folded = foldAccents(text)
		.replace(/\s+/g, ' ')
		.replace(/(\p{Ll})- (\p{Ll})/gu, '$1$2')
		.trim();
	if (!folded) return undefined;
	return folded.length > MAX_PAGE_TEXT ? folded.slice(0, MAX_PAGE_TEXT) : folded;
}

/** Text items of a pdf.js page joined into one string. */
export function textFromItems(items: unknown[]): string {
	return items
		.map((i) =>
			typeof i === 'object' && i !== null && 'str' in i && typeof i.str === 'string'
				? i.str
				: '',
		)
		.join(' ');
}

export interface ExactQuery {
	/** Whole tokens every result page must contain, accent-folded. */
	terms: string[];
	/** Quoted phrases, accent-folded and lower case; their words are also in `terms`. */
	phrases: string[];
}

const strip = (t: string): string => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Exact parts of a query: quoted phrases, and identifier-like tokens that contain both a letter
 * and a digit and are at least 3 characters long (`INV-2291`, `p99`, `v0.16.1`; not `3D` or
 * `0.7`). The benchmark found looser rules (hyphenated words, acronyms) fire on descriptive queries
 * and push the right page down. Returns null when the query has no exact part.
 */
export function exactQuery(query: string): ExactQuery | null {
	const phrases: string[] = [];
	const terms: string[] = [];
	const rest = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
		const words = phrase.split(/\s+/).map(strip).filter(Boolean);
		if (words.length > 0) {
			phrases.push(foldAccents(words.join(' ')).toLowerCase());
			terms.push(...words.map(foldAccents));
		}
		return ' ';
	});
	for (const raw of rest.split(/\s+/)) {
		const token = strip(raw);
		if (token.length >= 3 && /\p{L}/u.test(token) && /\p{N}/u.test(token)) {
			terms.push(foldAccents(token));
		}
	}
	const unique = [...new Set(terms)];
	return unique.length > 0 ? { terms: unique, phrases } : null;
}

/** Whether every phrase appears in the text in order, ignoring case and spacing. */
export function containsPhrases(text: string, phrases: string[]): boolean {
	const haystack = ` ${foldAccents(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
	return phrases.every((p) =>
		haystack.includes(` ${p.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `),
	);
}
