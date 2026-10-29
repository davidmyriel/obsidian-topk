import { describe, expect, it } from 'vitest';
import { emptyState } from '../../src/indexer/state';
import {
	fileName,
	noteBaseName,
	pageLinkText,
	resultsNote,
	wikiLink,
} from '../../src/search/links';
import { resolveHits } from '../../src/search/results';
import type { SearchHit } from '../../src/topk/client';

describe('page links', () => {
	it('links PDFs to their page and images to the file', () => {
		expect(pageLinkText('Talks/talk.pdf', 15, 'pdf_page')).toBe('Talks/talk.pdf#page=15');
		expect(pageLinkText('img/a b.png', 1, 'image')).toBe('img/a b.png');
		expect(wikiLink({ path: 'talk.pdf', page: 3, kind: 'pdf_page' })).toBe(
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
