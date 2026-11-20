import { describe, expect, it } from 'vitest';
import { emptyState, type IndexState } from '../../src/indexer/state';
import type { ResolvedResult } from '../../src/search/links';
import {
	MAX_NAME_MATCHES,
	nameMatches,
	shortQueryWords,
	withNameMatches,
} from '../../src/search/nameMatch';

describe('shortQueryWords', () => {
	it('keeps one or two content words, folded, and ignores longer queries', () => {
		expect(shortQueryWords('Map')).toEqual(['map']);
		expect(shortQueryWords('a map')).toEqual(['map']);
		expect(shortQueryWords('the Crème brûlée')).toEqual(['creme', 'brulee']);
		expect(shortQueryWords('old world map')).toEqual([]);
		expect(shortQueryWords('the of a')).toEqual([]);
		expect(shortQueryWords('   ')).toEqual([]);
	});
});

describe('nameMatches', () => {
	it('matches whole words of the file name, ignoring case, accents and plurals', () => {
		expect(nameMatches('Atlas/Larousse world map, 1900.jpg', ['map'])).toBe(true);
		expect(nameMatches('Atlas/Larousse world map, 1900.jpg', ['maps'])).toBe(true);
		expect(nameMatches('Notes/Handwritten letter 01.png', ['letter'])).toBe(true);
		expect(nameMatches('Notes/Recettes crème.pdf', ['creme'])).toBe(true);
		expect(nameMatches('Notes/Recettes crème.pdf', ['recette'])).toBe(true);
		// Words, not substrings; the folder and extension don't count.
		expect(nameMatches('Notes/Mapping study.pdf', ['map'])).toBe(false);
		expect(nameMatches('Maps/Subway.jpg', ['map'])).toBe(false);
		expect(nameMatches('Notes/report.pdf', ['pdf'])).toBe(false);
		expect(nameMatches('Larousse world map.jpg', ['world', 'map'])).toBe(true);
		expect(nameMatches('Larousse world map.jpg', ['world', 'atlas'])).toBe(false);
	});
});

function vault(paths: Record<string, 'pdf' | 'image' | 'failed'>): IndexState {
	const state = emptyState('v', 'c');
	for (const [i, [path, kind]] of Object.entries(paths).entries()) {
		const hash = `h${i}`;
		state.files[path] = { hash, size: 1, mtime: 1 };
		state.hashes[hash] = {
			kind: kind === 'failed' ? 'pdf' : kind,
			extension: kind === 'image' ? 'jpg' : 'pdf',
			pageCount: 1,
			ids: [],
			status: kind === 'failed' ? 'failed' : 'indexed',
			updatedAt: 0,
		};
	}
	return state;
}

const hit = (path: string, page: number, hash: string, score: number): ResolvedResult => ({
	path,
	page,
	kind: path.endsWith('.pdf') ? 'pdf_page' : 'image',
	score,
	contentHash: hash,
});

describe('withNameMatches', () => {
	const state = vault({
		'Larousse world map, 1900.jpg': 'image',
		'NYC Subway Map.jpg': 'image',
		'Qwen report.pdf': 'pdf',
		'Broken map.pdf': 'failed',
	});
	const visual = [
		hit('Qwen report.pdf', 2, 'h2', 0.95),
		hit('NYC Subway Map.jpg', 1, 'h1', 1.03),
	];

	it('puts files named after a short query first, keeping their visual rank and page', () => {
		const out = withNameMatches(visual, 'map', state, 10);
		expect(out.map((r) => [r.path, r.nameMatch ?? false])).toEqual([
			['NYC Subway Map.jpg', true], // returned by TopK: keeps its place among matches
			['Larousse world map, 1900.jpg', true], // not returned: page 1 of the image
			['Qwen report.pdf', false],
		]);
		expect(out[1]).toMatchObject({ page: 1, kind: 'image', contentHash: 'h0' });
	});

	it('leaves longer queries, queries with no match and failed files alone', () => {
		expect(withNameMatches(visual, 'old world map', state, 10)).toBe(visual);
		expect(withNameMatches(visual, 'atlas', state, 10)).toBe(visual);
		const out = withNameMatches([], 'broken', state, 10);
		expect(out).toEqual([]); // "Broken map.pdf" failed to index, so TopK has no page for it
	});

	it('skips files that no longer exist and respects the limit', () => {
		const out = withNameMatches(visual, 'map', state, 2, (p) => !p.startsWith('Larousse'));
		expect(out.map((r) => r.path)).toEqual(['NYC Subway Map.jpg', 'Qwen report.pdf']);
	});

	it(`moves at most ${MAX_NAME_MATCHES} files`, () => {
		const many = vault(
			Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`map ${i}.jpg`, 'image'])),
		);
		const out = withNameMatches([], 'map', many, 10);
		expect(out).toHaveLength(MAX_NAME_MATCHES);
	});
});
