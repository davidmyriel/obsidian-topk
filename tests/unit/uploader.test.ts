import { describe, expect, it } from 'vitest';
import { Uploader } from '../../src/indexer/uploader';
import { TopKError, type PageDoc } from '../../src/topk/client';
import { FakeTopK } from '../../src/topk/fake';

const page = (n: number, bytes = 10): PageDoc => ({
	id: `h:${n}:0`,
	vaultId: 'v',
	contentHash: 'h',
	page: n,
	tile: 0,
	kind: 'pdf_page',
	image: { format: 'jpeg', bytes: new Uint8Array(bytes) },
});

/** A fake whose upserts resolve only when released, to observe concurrency. */
class SlowTopK extends FakeTopK {
	pending: (() => void)[] = [];
	override upsertPages(pages: PageDoc[]): Promise<{ lsn: string }> {
		return new Promise((resolve, reject) => {
			this.pending.push(() => {
				super.upsertPages(pages).then(resolve, reject);
			});
		});
	}
	releaseAll(): void {
		for (const r of this.pending.splice(0)) r();
	}
}

describe('Uploader', () => {
	it('keeps at most `concurrency` requests in flight and reports every batch', async () => {
		const client = new SlowTopK();
		await client.ensureCollection();
		const batches: number[][] = [];
		const uploader = new Uploader(client, { concurrency: 2, flushBytes: 10 }, (pages) => {
			batches.push(pages.map((p) => p.page));
		});
		const adding = (async () => {
			for (let n = 1; n <= 5; n++) await uploader.add(page(n));
		})();
		// Let the event loop settle, then release requests until everything is sent.
		for (let i = 0; i < 10 && batches.length < 5; i++) {
			await new Promise((r) => setTimeout(r, 0));
			expect(client.pending.length).toBeLessThanOrEqual(2);
			client.releaseAll();
		}
		await adding;
		const draining = uploader.drain();
		client.releaseAll();
		await draining;
		expect(uploader.maxInflight).toBe(2);
		expect(batches.flat().sort()).toEqual([1, 2, 3, 4, 5]);
		expect(client.docs.size).toBe(5);
	});

	it('buffers until flushBytes, then sends one batch', async () => {
		const client = new FakeTopK();
		await client.ensureCollection();
		const sizes: number[] = [];
		const uploader = new Uploader(client, { concurrency: 4, flushBytes: 25 }, (pages) => {
			sizes.push(pages.length);
		});
		for (let n = 1; n <= 5; n++) await uploader.add(page(n));
		await uploader.drain();
		expect(sizes).toEqual([3, 2]);
	});

	it('rethrows the first upload error on the next add or drain', async () => {
		const client = new FakeTopK();
		await client.ensureCollection();
		client.failWith = new TopKError('network', 'offline');
		const uploader = new Uploader(client, { concurrency: 1, flushBytes: 1 }, () => undefined);
		await uploader.add(page(1));
		await expect(uploader.drain()).rejects.toThrow('offline');
		await expect(uploader.add(page(2))).rejects.toThrow('offline');
		expect(uploader.error).toBeInstanceOf(TopKError);
	});
});
