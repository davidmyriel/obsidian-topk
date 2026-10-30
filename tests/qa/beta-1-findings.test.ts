// Reproductions for docs/qa/beta-1-findings.md. Each test asserts the behaviour we expect, so it
// FAILS while the bug exists. Run with: npx vitest run --project qa
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_INDEX_OPTIONS,
	planIndex,
	runIndex,
	type IndexOptions,
	type IndexProgress,
} from '../../src/indexer/indexer';
import { emptyState, parseState, type IndexState } from '../../src/indexer/state';
import { prepareImage } from '../../src/render/pageSource';
import type { PdfJsLike } from '../../src/render/pdfRenderer';
import { resolveHits } from '../../src/search/results';
import { TopKError, type PageDoc } from '../../src/topk/client';
import { FakeTopK } from '../../src/topk/fake';
import { fixtureScorer, HERO, HERO_QUERY } from '../support/fixtures';
import { DiskVault, nodeRenderEnv, tempVault } from '../support/nodeVault';

const options: IndexOptions = {
	...DEFAULT_INDEX_OPTIONS,
	includeFolders: [],
	excludeGlobs: [],
	maxPagesPerFile: 300,
	maxPixels: 300_000,
};

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function vault(): { root: string; reader: DiskVault } {
	const tmp = tempVault();
	cleanup = tmp.cleanup;
	return { root: tmp.root, reader: new DiskVault(tmp.root) };
}

const noSave = (): Promise<void> => Promise.resolve();

const textImage = (w: number, h: number, background: boolean): Uint8Array => {
	const c = createCanvas(w, h);
	const ctx = c.getContext('2d');
	if (background) {
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, w, h);
	}
	ctx.fillStyle = '#000000';
	ctx.font = 'bold 48px sans-serif';
	ctx.fillText('QUARTERLY REVENUE FORECAST', 10, h / 2);
	return new Uint8Array(c.encodeSync('png'));
};

/**
 * Rejects an upsert whose image bytes do not match the declared format, failing the whole request,
 * exactly as live TopK did on 2026-10-30 ("Invalid image: Format error decoding Jpeg ...").
 */
class StrictTopK extends FakeTopK {
	override upsertPages(pages: PageDoc[]): Promise<{ lsn: string }> {
		for (const p of pages) {
			const b = p.image.bytes;
			const isPng = b[0] === 0x89 && b[1] === 0x50;
			const isJpeg = b[0] === 0xff && b[1] === 0xd8;
			if ((p.image.format === 'png' && !isPng) || (p.image.format === 'jpeg' && !isJpeg)) {
				return Promise.reject(
					new TopKError(
						'invalid',
						'TopK rejected the request: Invalid image: Format error',
					),
				);
			}
		}
		return super.upsertPages(pages);
	}
}

describe('F1: a misnamed image (PNG bytes in a .jpg) blocks indexing for every run', () => {
	it('records the bad file as failed and still indexes the other files', async () => {
		const { root, reader } = vault();
		// A PNG saved with a .jpg extension: common for downloads and screenshots.
		writeFileSync(join(root, 'Photos', 'misnamed.jpg'), textImage(400, 300, true));
		const client = new StrictTopK();
		await client.ensureCollection();
		const state = emptyState('v1', 'c');
		const deps = { reader, client, env: nodeRenderEnv, state, save: noSave };
		for (let run = 0; run < 2; run++) {
			try {
				await runIndex(deps, options);
			} catch {
				// The background run swallows this into a notice and tries again next time.
			}
		}
		const statuses = Object.values(state.hashes).map((h) => h.status);
		expect(statuses.filter((s) => s === 'indexed').length).toBe(4); // the 4 fixture files
		expect(statuses).toContain('failed'); // misnamed.jpg, reported in Show index status
	});

	it('declares the format the bytes actually have', async () => {
		const png = textImage(400, 300, true);
		const out = await prepareImage(nodeRenderEnv, 'jpg', png, {
			maxPixels: 1_310_720,
			quality: 0.85,
			maxBytes: 512 * 1024,
		});
		const isPng = out.bytes[0] === 0x89 && out.bytes[1] === 0x50;
		expect(isPng ? 'png' : 'jpeg').toBe(out.format);
	});
});

describe('F2: transparent PNGs are uploaded with their alpha channel', () => {
	it('flattens a transparent PNG onto white before upload', async () => {
		const transparent = textImage(1200, 400, false);
		const out = await prepareImage(nodeRenderEnv, 'png', transparent, {
			maxPixels: 1_310_720,
			quality: 0.85,
			maxBytes: 512 * 1024,
		});
		// Live TopK scored this image 1.22 for its own text vs 3.22 for the same image on white.
		expect(out.bytes).not.toBe(transparent);
	});
});

describe('F3: pages of a file that fails mid-render stay in TopK untracked', () => {
	it('removes every uploaded page of a failed file once the file is deleted', async () => {
		const { root, reader } = vault();
		const client = new FakeTopK();
		const state = emptyState('v1', 'c');
		// talk.pdf (3 pages) fails on page 3, after pages 1–2 were buffered for upload.
		const real = await nodeRenderEnv.loadPdfJs();
		const failing: PdfJsLike = {
			getDocument: (src) => {
				const task = real.getDocument(src);
				return {
					destroy: () => task.destroy(),
					promise: task.promise.then((doc) => ({
						numPages: doc.numPages,
						getPage: (n: number) =>
							doc.numPages === 3 && n === 3
								? Promise.reject(new Error('broken page'))
								: doc.getPage(n),
					})),
				};
			},
		};
		const env = { ...nodeRenderEnv, loadPdfJs: () => Promise.resolve(failing) };
		await runIndex({ reader, client, env, state, save: noSave }, options);
		rmSync(join(root, 'Talks', 'talk.pdf'));
		await runIndex({ reader, client, env, state, save: noSave }, options);
		const tracked = new Set(Object.values(state.hashes).flatMap((h) => h.ids));
		const untracked = [...client.docs.keys()].filter((id) => !tracked.has(id));
		expect(untracked).toEqual([]);
	});
});

describe('F4: a copied vault shares the vault id with the original', () => {
	it('deleting a file in the copy does not remove the original vault’s pages', async () => {
		const a = vault();
		const cleanA = cleanup;
		const client = new FakeTopK(await fixtureScorer(a.root));
		const stateA = emptyState('vault-id', 'c');
		await runIndex(
			{ reader: a.reader, client, env: nodeRenderEnv, state: stateA, save: noSave },
			options,
		);
		// The user duplicates the vault folder, .obsidian (and index-state.json) included.
		const b = vault();
		const stateB: IndexState = structuredClone(stateA);
		rmSync(join(b.root, HERO.path));
		await runIndex(
			{ reader: b.reader, client, env: nodeRenderEnv, state: stateB, save: noSave },
			options,
		);
		cleanA?.();
		// The original vault still has talk.pdf and still says it is indexed.
		const hits = await client.search(HERO_QUERY, 20, stateA.vaultId);
		expect(resolveHits(hits, stateA, 10)[0]).toMatchObject(HERO);
	});
});

describe('F5: a corrupt index-state.json loses the vault id', () => {
	it('keeps the vault id so Remove my data still reaches the earlier uploads', async () => {
		const { reader } = vault();
		const client = new FakeTopK();
		const state = emptyState('original-id', 'c');
		await runIndex({ reader, client, env: nodeRenderEnv, state, save: noSave }, options);
		// A crash during adapter.write leaves truncated JSON; JSON.parse fails and load() passes null.
		const reloaded = parseState(null, () => 'fresh-id', 'c');
		await runIndex(
			{ reader, client, env: nodeRenderEnv, state: reloaded, save: noSave },
			options,
		);
		await client.deleteVault(reloaded.vaultId); // Remove my data from TopK
		expect(client.docs.size).toBe(0);
	});
});

describe('F6: tall images break the page count used for progress and cost', () => {
	it('counts every tile in the plan, so progress never shows done > total', async () => {
		const { root, reader } = vault();
		mkdirSync(join(root, 'Shots'));
		const tall = createCanvas(400, 9000);
		const ctx = tall.getContext('2d');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, 400, 9000);
		writeFileSync(join(root, 'Shots', 'long-screenshot.png'), tall.encodeSync('png'));
		const client = new FakeTopK();
		const state = emptyState('v1', 'c');
		const plan = await planIndex({ reader, env: nodeRenderEnv, state }, options);
		const seen: IndexProgress[] = [];
		await runIndex(
			{
				reader,
				client,
				env: nodeRenderEnv,
				state,
				save: noSave,
				onProgress: (p) => seen.push(p),
			},
			options,
			plan,
		);
		const worst = seen.filter((p) => p.phase === 'uploading').at(-1);
		expect(client.calls.upsertedPages).toBe(plan.totalPages); // the cost estimate's page count
		expect(worst?.done).toBeLessThanOrEqual(worst?.total ?? 0);
	});
});
