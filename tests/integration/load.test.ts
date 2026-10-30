import { expect, it } from 'vitest';
import { DEFAULT_INDEX_OPTIONS, runIndex } from '../../src/indexer/indexer';
import { emptyState } from '../../src/indexer/state';
import type { PageDoc } from '../../src/topk/client';
import { FakeTopK } from '../../src/topk/fake';
import { SyntheticVault, syntheticEnv, syntheticPdf } from '../support/synthetic';

/** A fake that keeps ids but drops image bytes, like the real service from our side. */
class LeanTopK extends FakeTopK {
	override upsertPages(pages: PageDoc[]): Promise<{ lsn: string }> {
		return super.upsertPages(
			pages.map((p) => ({
				...p,
				image: { format: p.image.format, bytes: new Uint8Array(0) },
			})),
		);
	}
}

it('indexes 5,000 pages with bounded memory and a compact state', async () => {
	expect(typeof global.gc).toBe('function'); // vitest.config.ts passes --expose-gc
	const vault = new SyntheticVault();
	for (let f = 0; f < 50; f++)
		vault.files.set(`docs/file-${f}.pdf`, syntheticPdf(100, String(f)));
	const client = new LeanTopK();
	// 120 KB per page: the average upload size at the full pixel budget.
	const env = syntheticEnv(120 * 1024);
	const state = emptyState('vault-1', 'pages');

	// Image bytes live in ArrayBuffers, outside the JS heap, so count both. Garbage is collected
	// before each sample, so the peak is what the indexer holds, not what the collector has not
	// reached yet. Sampled every 250 pages and at every save.
	const used = (): number => {
		const m = process.memoryUsage();
		return m.heapUsed + m.arrayBuffers;
	};
	global.gc?.();
	const baseline = used();
	let peak = baseline;
	const sample = (): void => {
		global.gc?.();
		peak = Math.max(peak, used());
	};

	let saves = 0;
	const started = performance.now();
	const summary = await runIndex(
		{
			reader: vault,
			client,
			env,
			state,
			save: (s) => {
				saves++;
				JSON.stringify(s);
				sample();
				return Promise.resolve();
			},
			onProgress: (p) => {
				if (p.phase === 'uploading' && p.done % 250 === 0) sample();
			},
		},
		{
			...DEFAULT_INDEX_OPTIONS,
			includeFolders: [],
			excludeGlobs: [],
			maxPagesPerFile: 300,
			maxPixels: 1_310_720,
		},
	);
	const seconds = (performance.now() - started) / 1000;
	const growthMb = (peak - baseline) / 1024 / 1024;
	const stateKb = JSON.stringify(state).length / 1024;
	console.log(
		`load: 5,000 pages in ${seconds.toFixed(2)} s, ${client.calls.upsertRequests} requests, ` +
			`${saves} saves, retained memory peak +${growthMb.toFixed(0)} MB (heap + buffers), ` +
			`state ${stateKb.toFixed(0)} KB`,
	);

	expect(summary.pagesUploaded).toBe(5000);
	expect(env.rendered).toBe(5000);
	expect(client.docs.size).toBe(5000);
	// 5,000 x 120 KB is 586 MB of images. What is retained should be one 4 MB buffer plus up to
	// four 4 MB requests in flight, and the state.
	expect(growthMb).toBeLessThan(64);
	// About 4 MB per request: under TopK's 8 MB limit, and few requests.
	expect(client.calls.upsertRequests).toBeLessThan(200);
	expect(stateKb).toBeLessThan(1024);
	expect(seconds).toBeLessThan(30);
}, 60_000);
