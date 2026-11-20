import type { HashEntry, IndexState } from '../indexer/state';
import type { ResolvedResult } from './links';

// File-name matching for short queries. One or two words give the image model too little to rank
// by ("map" leaves a map image outside the top 10 while "old world map" ranks it first), but file
// names often say what a file shows. This runs on the device: file names never go to TopK.
// No obsidian import, so it is unit-testable.

/** Queries with at most this many content words get file-name matching. */
export const SHORT_QUERY_WORDS = 2;
/** At most this many files are moved up by their name, so a common word cannot flood results. */
export const MAX_NAME_MATCHES = 5;

const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'for',
	'in',
	'my',
	'of',
	'on',
	'or',
	'the',
	'to',
	'with',
]);

const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const words = (s: string): string[] =>
	fold(s)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/** The query's content words, folded; empty for anything that is not a short query. */
export function shortQueryWords(query: string): string[] {
	const content = words(query).filter((w) => !STOP_WORDS.has(w));
	return content.length > 0 && content.length <= SHORT_QUERY_WORDS ? content : [];
}

/**
 * A word and its possible singulars: "maps" → map, "boxes" → box or boxe, "recettes" → recette.
 * Two words match when these sets overlap. Words of three letters or fewer are kept as they are.
 */
const forms = (w: string): string[] => {
	const out = [w];
	if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
	if (w.length > 4 && w.endsWith('es')) out.push(w.slice(0, -2));
	return out;
};

const baseName = (path: string): string => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
};

/** True when every query word is a word of the file's name (ignoring case, accents and plurals). */
export function nameMatches(path: string, queryWords: string[]): boolean {
	const name = new Set(words(baseName(path)).flatMap(forms));
	return queryWords.length > 0 && queryWords.every((w) => forms(w).some((f) => name.has(f)));
}

const searchable = (entry: HashEntry | undefined): boolean =>
	entry?.status === 'indexed' || entry?.status === 'partial';

/**
 * Moves indexed files whose name contains every word of a short query to the top, keeping their
 * best visual page when TopK returned one (else page 1). Other results follow in visual order.
 * Longer queries are returned unchanged.
 */
export function withNameMatches(
	results: ResolvedResult[],
	query: string,
	state: IndexState,
	limit: number,
	exists: (path: string) => boolean = () => true,
): ResolvedResult[] {
	const queryWords = shortQueryWords(query);
	if (queryWords.length === 0) return results;
	const matches: ResolvedResult[] = [];
	const used = new Set<ResolvedResult>();
	// Files TopK already returned keep their best page and rank.
	for (const r of results) {
		if (matches.length >= MAX_NAME_MATCHES) break;
		if (matches.some((m) => m.path === r.path) || !nameMatches(r.path, queryWords)) continue;
		matches.push({ ...r, nameMatch: true });
		used.add(r);
	}
	// Then matching files TopK did not return, by path.
	for (const path of Object.keys(state.files).sort()) {
		if (matches.length >= MAX_NAME_MATCHES) break;
		if (matches.some((m) => m.path === path) || !nameMatches(path, queryWords)) continue;
		const stamp = state.files[path];
		const entry = stamp ? state.hashes[stamp.hash] : undefined;
		if (!stamp || !entry || !searchable(entry) || !exists(path)) continue;
		matches.push({
			path,
			page: 1,
			kind: entry.kind === 'pdf' ? 'pdf_page' : 'image',
			score: 0,
			contentHash: stamp.hash,
			nameMatch: true,
		});
	}
	if (matches.length === 0) return results;
	return [...matches, ...results.filter((r) => !used.has(r))].slice(0, limit);
}
