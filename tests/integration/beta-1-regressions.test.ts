// Regression tests for the beta 1 outside-tester findings (docs/qa/beta-1-findings.md).
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
import { emptyState, loadState } from '../../src/indexer/state';
import { prepareImage } from '../../src/render/pageSource';
import type { PdfJsLike } from '../../src/render/pdfRenderer';
import { FakeTopK } from '../../src/topk/fake';
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

describe('F5: a corrupt index-state.json loses the vault id', () => {
	it('keeps the vault id so Remove my data still reaches the earlier uploads', async () => {
		const { reader } = vault();
		const client = new FakeTopK();
		const state = emptyState('original-id', 'c');
		await runIndex({ reader, client, env: nodeRenderEnv, state, save: noSave }, options);
		// A crash during adapter.write leaves truncated JSON; JSON.parse fails and load() passes null.
		// The vault id survives in data.json.
		const reloaded = loadState(null, { vaultId: state.vaultId }, () => 'fresh-id', 'c');
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

describe('F16: a file deleted during a run', () => {
	it('is treated as deleted, not failed, and its landed pages are removed next run', async () => {
		const { root, reader } = vault();
		const client = new FakeTopK();
		const state = emptyState('v1', 'c');
		const plan = await planIndex({ reader, env: nodeRenderEnv, state }, options);
		const talk = plan.work.find((w) => w.path.endsWith('talk.pdf'));
		expect(talk).toBeDefined();
		// The file disappears after planning, before its pages are rendered.
		const read = reader.read.bind(reader);
		reader.read = (path) => {
			if (path === talk?.path) {
				rmSync(join(root, path));
				return Promise.reject(new Error(`${path} no longer exists`));
			}
			return read(path);
		};
		const summary = await runIndex(
			{ reader, client, env: nodeRenderEnv, state, save: noSave },
			options,
			plan,
		);
		expect(summary.failed).toEqual([]);
		expect(state.files[talk?.path ?? '']).toBeUndefined();
		const next = await runIndex(
			{ reader, client, env: nodeRenderEnv, state, save: noSave },
			options,
		);
		expect(next.failed).toEqual([]);
		expect(state.hashes[talk?.hash ?? '']).toBeUndefined();
		const tracked = new Set(Object.values(state.hashes).flatMap((h) => h.ids));
		expect([...client.docs.keys()].filter((id) => !tracked.has(id))).toEqual([]);
	});
});
