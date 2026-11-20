import { notePathsByHash, type NotesState } from '../notes/indexer';
import type { NoteHit, NotesClient } from '../topk/notes';
import { exactQuery } from './exact';

// Notes search (ADR-007): semantic similarity on note text, plus TopK's one-query hybrid for
// exact parts (quotes and codes). One result per note: its best section.

export interface NoteResult {
	path: string;
	/** Heading of the matching section, '' for text before the first heading. */
	heading: string;
	chunk: number;
	score: number;
	contentHash: string;
	/** The section contains the query's exact terms. */
	exactMatch?: boolean;
}

/** Notes scoring below this fraction of the best note's score are not shown (exact matches are). */
export const NOTE_SCORE_RATIO = 0.7;

export async function searchNotes(
	client: NotesClient,
	query: string,
	state: NotesState,
	options: {
		k: number;
		fetchK: number;
		exists?: (path: string) => boolean;
		onExactError?: (err: unknown) => void;
	},
): Promise<NoteResult[]> {
	if (!Object.values(state.notes).some((n) => n.status === 'indexed' && n.ids.length > 0)) {
		return [];
	}
	const exists = options.exists ?? (() => true);
	const lsn = state.lastLsn ? { requiredLsn: state.lastLsn } : {};
	const exact = exactQuery(query);
	const [semantic, exactHits] = await Promise.all([
		client.search(query, options.fetchK, state.vaultId, lsn),
		exact
			? client
					.search(query, options.fetchK, state.vaultId, {
						...lsn,
						exactTerms: exact.terms,
					})
					.catch((err: unknown): NoteHit[] => {
						options.onExactError?.(err);
						return [];
					})
			: Promise.resolve<NoteHit[]>([]),
	]);
	const paths = notePathsByHash(state);
	const out: NoteResult[] = [];
	const seen = new Set<string>();
	const add = (hits: NoteHit[], exactMatch: boolean): void => {
		for (const hit of hits) {
			if (out.length >= options.k) return;
			const path = paths.get(hit.contentHash)?.find(exists);
			if (!path || seen.has(path)) continue; // one result per note: its best section
			seen.add(path);
			out.push({
				path,
				heading: state.notes[hit.contentHash]?.headings[hit.chunk] ?? '',
				chunk: hit.chunk,
				score: hit.score,
				contentHash: hit.contentHash,
				...(exactMatch ? { exactMatch } : {}),
			});
		}
	};
	add(exactHits, true);
	// Semantic search always returns its top k, however weak. Show only notes that score close to
	// the best one, so a search about a page doesn't list five loosely related notes.
	const best = semantic.reduce((m, h) => Math.max(m, h.score), Number.NEGATIVE_INFINITY);
	add(
		semantic.filter((h) => h.score >= best * NOTE_SCORE_RATIO),
		false,
	);
	return out;
}
