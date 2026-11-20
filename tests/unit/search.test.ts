import { describe, expect, it } from 'vitest';
import { emptyState } from '../../src/indexer/state';
import { fileName, noteBaseName, resultsNote, noteLink } from '../../src/search/links';
import { cleanQuery, MAX_QUERY_CHARS, resolveHits } from '../../src/search/results';
import type { SearchHit } from '../../src/topk/client';

describe('page links', () => {
	it('links PDFs to their page and images to the file', () => {
		expect(noteLink({ path: 'img/a b.png', page: 1, kind: 'image' }, 'V')).toBe(
			'[[img/a b.png]]',
		);
		expect(noteLink({ path: 'talk.pdf', page: 3, kind: 'pdf_page' }, 'V')).toBe(
			'[[talk.pdf#page=3]]',
		);
		expect(fileName('a/b/c.pdf')).toBe('c.pdf');
	});

	it('writes a results note', () => {
		const note = resultsNote(
			'reranker diagram',
			[
				{ path: 'Talks/talk.pdf', page: 3, kind: 'pdf_page', score: 5, contentHash: 'h' },
				{ path: 'chart.png', page: 1, kind: 'image', score: 4, contentHash: 'i' },
			],
			new Date('2026-10-29T12:00:00Z'),
			'V',
		);
		expect(note).toBe(
			[
				'# Visual search: reranker diagram',
				'',
				'Searched 2026-10-29 with TopK Visual Search.',
				'',
				'1. [[Talks/talk.pdf#page=3]] (page 3)',
				'2. [[chart.png]]',
				'',
			].join('\n'),
		);
	});

	it('makes safe note names', () => {
		expect(noteBaseName('a/b: c? [x]#1')).toBe('Visual search - a b c x 1');
		expect(noteBaseName('   ')).toBe('Visual search - results');
		expect(noteBaseName('x'.repeat(100))).toHaveLength('Visual search - '.length + 60);
	});
});

describe('resolveHits', () => {
	const state = emptyState('v', 'c');
	state.files = {
		'b.pdf': { hash: 'h1', size: 1, mtime: 1 },
		'a.pdf': { hash: 'h1', size: 1, mtime: 1 },
		'img.png': { hash: 'h2', size: 1, mtime: 1 },
	};
	const hit = (hash: string, page: number, score: number, tile = 0): SearchHit => ({
		id: `${hash}:${page}:${tile}`,
		contentHash: hash,
		page,
		tile,
		kind: hash === 'h2' ? 'image' : 'pdf_page',
		score,
	});

	it('maps hashes to the first current path, drops deleted content and collapses tiles', () => {
		const out = resolveHits(
			[
				hit('gone', 1, 9),
				hit('h1', 2, 5),
				hit('h2', 1, 7, 0),
				hit('h2', 1, 6, 1),
				hit('h1', 1, 3),
			],
			state,
			10,
		);
		expect(out.map((r) => [r.path, r.page])).toEqual([
			['img.png', 1],
			['a.pdf', 2],
			['a.pdf', 1],
		]);
		expect(resolveHits([hit('h1', 1, 1), hit('h1', 2, 2)], state, 1)).toHaveLength(1);
	});
});

describe('noteLink (beta 1 F7)', () => {
	it('keeps wikilinks for ordinary names, including ^ which wikilinks handle', () => {
		expect(noteLink({ path: 'Docs/v2^final.pdf', page: 2, kind: 'pdf_page' }, 'V')).toBe(
			'[[Docs/v2^final.pdf#page=2]]',
		);
		expect(noteLink({ path: 'img/a b.png', page: 1, kind: 'image' }, 'V')).toBe(
			'[[img/a b.png]]',
		);
	});

	it('uses an encoded Markdown link for | and brackets', () => {
		expect(noteLink({ path: 'Docs/a|b (v2).pdf', page: 1, kind: 'pdf_page' }, 'V')).toBe(
			'[a|b (v2).pdf, page 1](Docs/a%7Cb%20%28v2%29.pdf#page=1)',
		);
		expect(noteLink({ path: 'Docs/[draft] plan.png', page: 1, kind: 'image' }, 'V')).toBe(
			'[\\[draft\\] plan.png](Docs/%5Bdraft%5D%20plan.png)',
		);
	});

	it('uses an obsidian://open link for # which no Obsidian link can contain', () => {
		expect(
			noteLink({ path: 'Talks/Q3 #1 review.pdf', page: 3, kind: 'pdf_page' }, 'My Vault'),
		).toBe(
			'[Q3 #1 review.pdf, page 3](obsidian://open?vault=My%20Vault&file=Talks%2FQ3%20%231%20review.pdf)',
		);
	});
});

describe('resolveHits with the live vault (beta 1 F8)', () => {
	it('skips paths that no longer exist and drops hits with none left', () => {
		const state = emptyState('v', 'c');
		state.files = {
			'old.pdf': { hash: 'h1', size: 1, mtime: 1 },
			'moved/new.pdf': { hash: 'h1', size: 1, mtime: 1 },
			'gone.pdf': { hash: 'h2', size: 1, mtime: 1 },
		};
		const hit = (hash: string, score: number): SearchHit => ({
			id: hash,
			contentHash: hash,
			page: 1,
			tile: 0,
			kind: 'pdf_page',
			score,
		});
		const exists = (p: string): boolean => p === 'moved/new.pdf';
		expect(
			resolveHits([hit('h2', 9), hit('h1', 5)], state, 10, exists).map((r) => r.path),
		).toEqual(['moved/new.pdf']);
	});
});

describe('renamePaths', () => {
	it('moves a file, and every file under a renamed folder', async () => {
		const { renamePaths } = await import('../../src/indexer/state');
		const state = emptyState('v', 'c');
		state.files = {
			'Talks/talk.pdf': { hash: 'h1', size: 1, mtime: 1 },
			'Talks/sub/b.pdf': { hash: 'h2', size: 1, mtime: 1 },
			'Talkshow.pdf': { hash: 'h3', size: 1, mtime: 1 },
		};
		expect(renamePaths(state, 'Talks', 'Archive/Talks')).toBe(true);
		expect(Object.keys(state.files).sort()).toEqual([
			'Archive/Talks/sub/b.pdf',
			'Archive/Talks/talk.pdf',
			'Talkshow.pdf',
		]);
		expect(renamePaths(state, 'Talkshow.pdf', 'show.pdf')).toBe(true);
		expect(state.files['show.pdf']?.hash).toBe('h3');
		expect(renamePaths(state, 'nope', 'x')).toBe(false);
	});
});

describe('cleanQuery (F12)', () => {
	it('trims, and cuts to the TopK limit by characters', () => {
		expect(cleanQuery('  slide  ')).toBe('slide');
		expect(Array.from(cleanQuery('a'.repeat(14_000)))).toHaveLength(MAX_QUERY_CHARS);
		// An emoji is two UTF-16 units but one character, and is never split.
		const emoji = cleanQuery('😀'.repeat(MAX_QUERY_CHARS + 5));
		expect(Array.from(emoji)).toHaveLength(MAX_QUERY_CHARS);
		expect(emoji.endsWith('😀')).toBe(true);
	});
});

describe('results note with notes (audit A05)', () => {
	it('lists notes at their heading before the pages, and works with notes only', () => {
		const date = new Date('2026-11-20T12:00:00Z');
		const notes = [
			{ path: 'Work/pricing.md', heading: 'Margins' },
			{ path: 'odd [1].md', heading: 'Plan | B' },
		];
		const mixed = resultsNote(
			'pricing',
			[{ path: 'deck.pdf', page: 2, kind: 'pdf_page', score: 1, contentHash: 'h' }],
			date,
			'V',
			notes,
		);
		expect(mixed).toContain('## Notes\n\n1. [[Work/pricing#Margins]]');
		expect(mixed).toContain('2. [odd \\[1\\]](odd%20%5B1%5D.md)'); // unsafe heading dropped
		expect(mixed.indexOf('## Notes')).toBeLessThan(mixed.indexOf('## Pages'));
		const notesOnly = resultsNote('pricing', [], date, 'V', notes);
		expect(notesOnly).toContain('[[Work/pricing#Margins]]');
		expect(notesOnly).not.toContain('## Pages');
	});
});
