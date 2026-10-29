import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfPagePreview, snippetFromItems } from '../../src/render/preview';
import { FIXTURE_VAULT } from '../support/fixtures';
import { loadNodePdfJs, nodeCanvasFactory, nodeDocumentOptions } from '../support/node-render';

describe('pdfPagePreview', () => {
	it('returns a JPEG thumbnail and the page text as one line', async () => {
		const data = new Uint8Array(readFileSync(join(FIXTURE_VAULT, 'Talks', 'talk.pdf')));
		const preview = await pdfPagePreview(await loadNodePdfJs(), data, 3, nodeCanvasFactory, {
			thumbnailLongSide: 240,
			snippetLength: 60,
			documentOptions: nodeDocumentOptions,
		});
		expect(Array.from(preview.thumbnail?.subarray(0, 2) ?? [])).toEqual([0xff, 0xd8]);
		expect(preview.snippet.startsWith('Reranker architecture')).toBe(true);
		expect(preview.snippet.length).toBeLessThanOrEqual(60);
		expect(preview.snippet.endsWith('…')).toBe(true);
	});
});

it('snippetFromItems skips non-text items and collapses whitespace', () => {
	expect(
		snippetFromItems([{ str: ' a\n' }, { type: 'beginMarkedContent' }, { str: 'b  c' }], 100),
	).toBe('a b c');
});
