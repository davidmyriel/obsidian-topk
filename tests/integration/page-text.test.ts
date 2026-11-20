import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_INDEX_OPTIONS, runIndex } from '../../src/indexer/indexer';
import { emptyState } from '../../src/indexer/state';
import { FakeTopK } from '../../src/topk/fake';
import { DiskVault, nodeRenderEnv, tempVault } from '../support/nodeVault';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('page text (ADR-006)', () => {
	it('uploads the text layer of PDF pages and none for images', async () => {
		const tmp = tempVault();
		cleanup = tmp.cleanup;
		const client = new FakeTopK();
		await runIndex(
			{
				reader: new DiskVault(tmp.root),
				client,
				env: nodeRenderEnv,
				state: emptyState('v', 'c'),
				save: () => Promise.resolve(),
			},
			{
				...DEFAULT_INDEX_OPTIONS,
				includeFolders: [],
				excludeGlobs: [],
				maxPagesPerFile: 300,
				maxPixels: 300_000,
			},
		);
		const docs = [...client.docs.values()];
		const pdfPages = docs.filter((d) => d.kind === 'pdf_page');
		const images = docs.filter((d) => d.kind !== 'pdf_page');
		expect(pdfPages.length).toBeGreaterThan(0);
		expect(pdfPages.filter((d) => (d.pageText ?? '').length > 0).length).toBeGreaterThan(0);
		expect(images.every((d) => d.pageText === undefined)).toBe(true);
		// Stored text is accent-folded and has no runs of whitespace.
		for (const d of pdfPages) {
			expect(d.pageText ?? '').not.toMatch(/\s{2,}|\p{M}/u);
		}
	});
});
