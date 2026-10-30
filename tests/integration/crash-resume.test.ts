import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEX_OPTIONS, runIndex, type IndexOptions } from '../../src/indexer/indexer';
import { emptyState, parseState, type IndexState } from '../../src/indexer/state';
import { FakeTopK } from '../../src/topk/fake';
import { SyntheticVault, syntheticEnv, syntheticPdf } from '../support/synthetic';

const base: IndexOptions = {
	...DEFAULT_INDEX_OPTIONS,
	includeFolders: [],
	excludeGlobs: [],
	maxPagesPerFile: 1000,
	maxPixels: 1_310_720,
};

describe.each([
	{ concurrency: 1, flushBytes: 1 },
	{ concurrency: 4, flushBytes: 3 * 1024 },
])('crash at page 50 and restart (concurrency $concurrency)', ({ concurrency, flushBytes }) => {
	it('finishes with every page exactly once and re-uploads at most what was in flight', async () => {
		const vault = new SyntheticVault();
		vault.files.set('big.pdf', syntheticPdf(120, 'a'));
		vault.files.set('small.pdf', syntheticPdf(10, 'b'));
		const total = 130;
		const client = new FakeTopK();
		const options = { ...base, concurrency, flushBytes };

		// Run 1 "crashes" at page 50: only what was saved survives, as after a process kill.
		let lastSaved = '';
		const controller = new AbortController();
		const state = emptyState('vault-1', 'pages');
		await runIndex(
			{
				reader: vault,
				client,
				env: syntheticEnv(1024),
				state,
				signal: controller.signal,
				save: (s: IndexState) => {
					lastSaved = JSON.stringify(s);
					return Promise.resolve();
				},
				onProgress: (p) => {
					if (p.phase === 'uploading' && p.done === 50) controller.abort();
				},
			},
			options,
		);
		const uploadedBeforeCrash = client.calls.upsertedPages;
		expect(uploadedBeforeCrash).toBeGreaterThan(0);
		expect(uploadedBeforeCrash).toBeLessThan(total);

		// Run 2 starts from disk.
		const restored = parseState(JSON.parse(lastSaved) as unknown, () => 'unused', 'pages');
		const env = syntheticEnv(1024);
		const summary = await runIndex(
			{ reader: vault, client, env, state: restored, save: () => Promise.resolve() },
			options,
		);
		expect(summary.failed).toEqual([]);
		expect(Object.values(restored.hashes).map((h) => h.status)).toEqual(['indexed', 'indexed']);

		// Exactly the expected documents, each once.
		const ids = [...client.docs.keys()].sort();
		expect(ids).toHaveLength(total);
		expect(new Set(ids).size).toBe(total);
		const recorded = Object.values(restored.hashes).flatMap((h) => h.ids);
		expect(new Set(recorded).size).toBe(total);

		// Re-uploads are bounded by what was in flight when the crash hit, never a whole file.
		const reuploaded = client.calls.upsertedPages - total;
		const pagesPerBatch = Math.max(1, Math.ceil(flushBytes / 1024));
		expect(reuploaded).toBeLessThanOrEqual(concurrency * pagesPerBatch + pagesPerBatch);
		// The restart rendered only pages that had not landed.
		expect(env.rendered).toBeLessThanOrEqual(
			total - uploadedBeforeCrash + concurrency * pagesPerBatch + pagesPerBatch,
		);
	});
});
