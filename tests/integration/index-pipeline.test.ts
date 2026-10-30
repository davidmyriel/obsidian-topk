import { mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	planIndex,
	runIndex,
	type IndexOptions,
	DEFAULT_INDEX_OPTIONS,
} from '../../src/indexer/indexer';
import { emptyState, pathsByHash, type IndexState } from '../../src/indexer/state';
import { TopKError } from '../../src/topk/client';
import { FakeTopK } from '../../src/topk/fake';
import { sha256Hex } from '../../src/util/hash';
import { FIXTURE_PAGE_COUNT, fixtureScorer, HERO, HERO_QUERY } from '../support/fixtures';
import { DiskVault, nodeRenderEnv, tempVault } from '../support/nodeVault';

const options: IndexOptions = {
	...DEFAULT_INDEX_OPTIONS,
	includeFolders: [],
	excludeGlobs: ['.obsidian/**', '.trash/**'],
	maxPagesPerFile: 300,
	maxPixels: 300_000, // small renders keep the test fast
};

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

async function setup() {
	const tmp = tempVault();
	cleanup = tmp.cleanup;
	const reader = new DiskVault(tmp.root);
	const client = new FakeTopK(await fixtureScorer(tmp.root));
	const state = emptyState('vault-1', 'pages');
	const saves: IndexState[] = [];
	const deps = {
		reader,
		client,
		env: nodeRenderEnv,
		state,
		save: (s: IndexState) => {
			saves.push(structuredClone(s));
			return Promise.resolve();
		},
	};
	return { root: tmp.root, reader, client, state, saves, deps };
}

describe('index pipeline on the fixture vault with a fake TopK', () => {
	it('indexes every page, finds the hero page and makes zero calls on re-index', async () => {
		const { client, state, deps, saves } = await setup();
		const progress: number[] = [];
		const summary = await runIndex(
			{ ...deps, onProgress: (p) => p.phase === 'uploading' && progress.push(p.done) },
			options,
		);

		expect(summary).toMatchObject({
			filesIndexed: 4,
			pagesUploaded: FIXTURE_PAGE_COUNT,
			failed: [],
			skipped: [],
		});
		expect(client.docs.size).toBe(FIXTURE_PAGE_COUNT);
		expect(progress.at(-1)).toBe(FIXTURE_PAGE_COUNT);
		expect(saves.length).toBeGreaterThanOrEqual(4);

		// Ids are content hash + page + tile, and every document carries the vault id.
		const talkHash = state.files[HERO.path]?.hash ?? '';
		expect(state.hashes[talkHash]).toMatchObject({
			status: 'indexed',
			pageCount: 3,
			ids: [`${talkHash}:1:0`, `${talkHash}:2:0`, `${talkHash}:3:0`],
		});
		expect([...client.docs.values()].every((d) => d.vaultId === 'vault-1')).toBe(true);

		// Images over the pixel budget (an 800×600 PNG at 300k) and WebP are re-encoded as JPEG.
		const docs = [...client.docs.values()];
		const png = docs.find((d) => d.contentHash === state.files['market-share.png']?.hash);
		const webp = docs.find((d) => d.contentHash === state.files['Photos/sunset.webp']?.hash);
		expect(png?.image.format).toBe('jpeg');
		expect(webp).toMatchObject({ kind: 'image', image: { format: 'jpeg' } });
		expect(docs.every((d) => d.image.bytes.length <= 512 * 1024)).toBe(true);

		const [top] = await client.search(HERO_QUERY, 20, 'vault-1');
		expect(top).toMatchObject({ contentHash: talkHash, page: HERO.page });

		const before = { ...client.calls };
		const again = await runIndex(deps, options);
		expect(again).toMatchObject({ filesIndexed: 0, filesUnchanged: 4, pagesUploaded: 0 });
		expect(client.calls).toEqual(before);
	});

	it('renames and moves cost nothing; duplicates are stored once', async () => {
		const { root, client, state, deps, reader } = await setup();
		await runIndex(deps, options);
		const uploads = client.calls.upsertedPages;

		mkdirSync(join(root, 'Archive'));
		renameSync(join(root, 'Talks', 'talk.pdf'), join(root, 'Archive', 'renamed.pdf'));
		writeFileSync(join(root, 'copy.pdf'), await reader.read('Archive/renamed.pdf'));
		const summary = await runIndex(deps, options);

		expect(summary.pagesUploaded).toBe(0);
		expect(client.calls.upsertedPages).toBe(uploads);
		const hash = state.files['Archive/renamed.pdf']?.hash ?? '';
		expect(pathsByHash(state).get(hash)).toEqual(['Archive/renamed.pdf', 'copy.pdf']);
		expect(state.files['Talks/talk.pdf']).toBeUndefined();
	});

	it('re-uploads only a file whose content changed, and skips re-hashing untouched files', async () => {
		const { root, client, deps, reader } = await setup();
		await runIndex(deps, options);
		const png = join(root, 'market-share.png');
		writeFileSync(png, new Uint8Array([...readFileSync(png), 0]));
		utimesSync(png, new Date(), new Date(Date.now() + 5000));
		const readsBefore = reader.reads;
		const before = client.calls.upsertedPages;
		const summary = await runIndex(deps, options);
		expect(summary.pagesUploaded).toBe(1);
		expect(client.calls.upsertedPages).toBe(before + 1);
		// Only the changed file is read again: once to hash, once to render (images need no count).
		expect(reader.reads - readsBefore).toBe(2);
	});

	it('honours include folders, exclude globs and the page limit', async () => {
		const { deps } = await setup();
		const plan = await planIndex(deps, {
			...options,
			includeFolders: ['Docs', 'Talks'],
			excludeGlobs: ['Talks/**'],
			maxPagesPerFile: 10,
		});
		expect(plan.work).toEqual([]);
		expect(plan.skipped).toEqual([
			{ path: 'Docs/handbook.pdf', pageCount: 15, reason: '15 pages, over the limit of 10' },
		]);

		const summary = await runIndex(deps, { ...options, maxPagesPerFile: 10 });
		expect(summary.skipped.map((s) => s.path)).toEqual(['Docs/handbook.pdf']);
		expect(summary.filesIndexed).toBe(3);
	});

	it('stops on an upload error after saving progress, then resumes', async () => {
		const { client, state, deps } = await setup();
		let uploads = 0;
		const original = client.upsertPages.bind(client);
		client.upsertPages = (pages) => {
			if (++uploads === 17) return Promise.reject(new TopKError('network', 'offline'));
			return original(pages);
		};
		// One page per request, one at a time: handbook (15) and market-share (1) land, then call 17 fails.
		const oneByOne = { ...options, flushBytes: 1, concurrency: 1 };
		await expect(runIndex(deps, oneByOne)).rejects.toThrow('offline');
		const byPath = (p: string) => state.hashes[state.files[p]?.hash ?? '']?.status;
		expect(byPath('Docs/handbook.pdf')).toBe('indexed');
		expect(byPath('market-share.png')).toBe('indexed');
		expect(byPath('Photos/sunset.webp')).toBe('partial');

		client.upsertPages = original;
		const summary = await runIndex(deps, options);
		expect(summary.failed).toEqual([]);
		expect(summary.filesIndexed).toBe(2);
		expect(Object.values(state.hashes).every((h) => h.status === 'indexed')).toBe(true);
		expect(client.docs.size).toBe(FIXTURE_PAGE_COUNT);
	});

	it('cancels between pages and leaves the file partial', async () => {
		const { state, deps } = await setup();
		const controller = new AbortController();
		const summary = await runIndex(
			{
				...deps,
				signal: controller.signal,
				onProgress: (p) => p.phase === 'uploading' && p.done === 5 && controller.abort(),
			},
			options,
		);
		expect(summary.cancelled).toBe(true);
		expect(Object.values(state.hashes).some((h) => h.status === 'partial')).toBe(true);
	});

	it('records a corrupt PDF as failed and indexes the rest', async () => {
		const { root, deps, state } = await setup();
		writeFileSync(join(root, 'broken.pdf'), 'not a pdf');
		const summary = await runIndex(deps, options);
		expect(summary.failed.map((f) => f.path)).toEqual(['broken.pdf']);
		expect(summary.filesIndexed).toBe(4);
		expect(state.files['broken.pdf']?.hash).toBe(
			await sha256Hex(new TextEncoder().encode('not a pdf')),
		);
	});
});

describe('prepareImage', () => {
	it('uploads a PNG unchanged when it fits the pixel budget and size limit', async () => {
		const { prepareImage } = await import('../../src/render/pageSource');
		const { FIXTURE_VAULT } = await import('../support/fixtures');
		const bytes = new Uint8Array(readFileSync(join(FIXTURE_VAULT, 'market-share.png')));
		const out = await prepareImage(nodeRenderEnv, 'png', bytes, {
			maxPixels: 1_310_720,
			quality: 0.85,
			maxBytes: 512 * 1024,
		});
		expect(out.format).toBe('png');
		expect(out.bytes).toBe(bytes);
	});
});
