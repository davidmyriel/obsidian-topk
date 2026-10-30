import { describe, expect, it } from 'vitest';
import { progressText, summaryText } from '../../src/indexer/progress';

const base = {
	filesIndexed: 0,
	filesUnchanged: 0,
	pagesUploaded: 0,
	pagesDeleted: 0,
	skipped: [],
	failed: [],
	cancelled: false,
};

describe('progress text', () => {
	it('formats scanning and indexing with thousands separators', () => {
		expect(progressText({ phase: 'scanning', done: 3, total: 40 })).toBe(
			'Scanning 3 / 40 files',
		);
		expect(progressText({ phase: 'uploading', done: 214, total: 1032 })).toBe(
			'Indexing 214 / 1,032 pages',
		);
	});

	it('mentions removed pages', () => {
		expect(summaryText({ ...base, pagesDeleted: 3, filesUnchanged: 2 })).toBe(
			'Indexing finished, 3 pages removed, 2 unchanged.',
		);
	});

	it('summarises runs', () => {
		expect(summaryText({ ...base, filesUnchanged: 4 })).toBe(
			'Index is up to date, 4 unchanged.',
		);
		expect(
			summaryText({
				...base,
				filesIndexed: 2,
				pagesUploaded: 18,
				failed: [{ path: 'a.pdf', reason: 'x' }],
			}),
		).toBe('Indexing finished, 18 pages from 2 files uploaded, 1 failed.');
		expect(summaryText({ ...base, cancelled: true, pagesUploaded: 5, filesIndexed: 1 })).toBe(
			'Indexing cancelled, 5 pages from 1 file uploaded.',
		);
	});
});
