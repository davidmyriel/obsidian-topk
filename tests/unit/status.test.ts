import { expect, it } from 'vitest';
import { emptyState } from '../../src/indexer/state';
import { indexStatus } from '../../src/indexer/status';

it('summarises the index per current path', () => {
	const state = emptyState('v', 'c');
	state.files = {
		'a.pdf': { hash: 'h1', size: 1, mtime: 1 },
		'copy of a.pdf': { hash: 'h1', size: 1, mtime: 1 },
		'broken.pdf': { hash: 'h2', size: 1, mtime: 1 },
		'huge.pdf': { hash: 'h3', size: 1, mtime: 1 },
		'half.pdf': { hash: 'h4', size: 1, mtime: 1 },
		'new.pdf': { hash: 'h5', size: 1, mtime: 1 },
	};
	const entry = (
		status: 'indexed' | 'failed' | 'skipped' | 'partial',
		pageCount: number,
		updatedAt: number,
		reason?: string,
	) => ({
		kind: 'pdf' as const,
		extension: 'pdf',
		pageCount,
		ids: [],
		status,
		updatedAt,
		...(reason ? { reason } : {}),
	});
	state.hashes = {
		h1: entry('indexed', 10, 100),
		h2: entry('failed', 0, 200, 'Invalid PDF structure'),
		h3: entry('skipped', 900, 50, '900 pages, over the limit of 300'),
		h4: entry('partial', 4, 300),
	};
	expect(indexStatus(state)).toEqual({
		files: 2,
		pages: 10,
		partial: 1,
		failed: [{ path: 'broken.pdf', reason: 'Invalid PDF structure' }],
		skipped: [{ path: 'huge.pdf', reason: '900 pages, over the limit of 300' }],
		lastIndexed: 300,
	});
});
