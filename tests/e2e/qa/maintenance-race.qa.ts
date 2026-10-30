// docs/qa/beta-1-findings.md F9/F10: maintenance commands confirmed while an index run is going.
import { browser, expect } from '@wdio/globals';
import { indexVault, isIndexing, PLUGIN_ID, statusBarText, useMockTopK } from '../helpers';
import { indexedCount, searchRows } from './qa-helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';

/** Opens a maintenance dialog, starts Index vault behind it, and confirms once uploading. */
async function confirmDuringRun(command: string, button: string): Promise<void> {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:${command}`);
	await browser.$(`button=${button}`).waitForExist();
	// What a 5 s background run does if it starts while the dialog is open.
	await browser.executeObsidian(({ plugins }) => {
		void (
			plugins.topkVisualSearch as unknown as { indexer: { run(): Promise<void> } }
		).indexer.run();
	});
	await browser.waitUntil(async () => (await statusBarText()).includes('Indexing'), {
		timeout: 20_000,
		interval: 50,
	});
	await browser.$(`button=${button}`).click();
	await browser.waitUntil(async () => !(await isIndexing()), { timeout: 60_000 });
}

describe('QA: Clear local index during a run', () => {
	before(async () => {
		await useMockTopK();
	});

	it('keeps search working after the next index', async () => {
		await confirmDuringRun('clear-local-index', 'Clear');
		await indexVault(); // purges TopK because of the Clear
		const indexed = await indexedCount();
		const { rows, status } = await searchRows(HERO_QUERY);
		await browser.keys('Escape');
		console.log('QA F9:', JSON.stringify({ indexed, rows: rows.length, status }));
		// Show index status claims every file is indexed...
		expect(indexed).toBe(4);
		// ...so search must find the hero page.
		expect(rows[0] ?? status).toContain('talk.pdf');
	});
});

describe('QA: Remove my data during a run', () => {
	before(async () => {
		await useMockTopK();
	});

	it('leaves nothing of this vault in TopK', async () => {
		await confirmDuringRun('remove-data-from-topk', 'Remove');
		const indexed = await indexedCount();
		const { rows, status } = await searchRows(HERO_QUERY);
		await browser.keys('Escape');
		console.log('QA F10 during run:', JSON.stringify({ indexed, rows: rows.length, status }));
		expect(rows).toEqual([]);
	});
});

describe('QA: Remove my data, then Obsidian restarts', () => {
	before(async () => {
		await useMockTopK({ autoIndex: true });
		await indexVault();
	});

	it('does not upload the vault again without asking', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:remove-data-from-topk`);
		await browser.$('button=Remove').click();
		await browser.waitUntil(async () => (await indexedCount()) === 0, { timeout: 10_000 });
		// onLayoutReady calls scheduler.request() on every start; same as a file change.
		await browser.executeObsidian(({ plugins }) => {
			(
				plugins.topkVisualSearch as unknown as { scheduler: { request(): void } }
			).scheduler.request();
		});
		await browser.pause(8_000);
		await browser.waitUntil(async () => !(await isIndexing()), { timeout: 60_000 });
		const indexed = await indexedCount();
		console.log('QA F10 after restart:', JSON.stringify({ indexed }));
		expect(indexed).toBe(0);
	});
});
