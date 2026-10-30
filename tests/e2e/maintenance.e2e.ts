// Maintenance commands confirmed while indexing runs, and Remove my data surviving a restart.
// Adapted from the outside tester's reproductions (docs/qa/beta-1-findings.md F9, F10).
import { browser, expect } from '@wdio/globals';
import { indexVault, isIndexing, PLUGIN_ID, statusBarText, useMockTopK } from './helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';

async function searchRows(query: string): Promise<{ rows: string[]; status: string }> {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:visual-search`);
	const input = browser.$('.topk-search-input');
	await input.waitForExist();
	await input.setValue(query);
	await browser.keys('Enter');
	await browser.waitUntil(
		async () => {
			const status = await browser.$('.topk-search-status').getText();
			return (
				status !== 'Searching…' &&
				(status !== '' || (await browser.$$('.topk-result').length) > 0)
			);
		},
		{ timeout: 20_000 },
	);
	const rows = await browser.$$('.topk-result').map((r) => r.getText());
	const status = await browser.$('.topk-search-status').getText();
	await browser.keys('Escape');
	return { rows, status };
}

async function indexedCount(): Promise<number> {
	const count = await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.topkVisualSearch as unknown as {
			stateStore: { load(): Promise<{ hashes: Record<string, { status: string }> }> };
		};
		const state = await plugin.stateStore.load();
		return Object.values(state.hashes).filter((h) => h.status === 'indexed').length;
	});
	return count;
}

/** Opens a maintenance dialog, starts Index vault behind it, and confirms once uploading. */
async function confirmDuringRun(command: string, button: string): Promise<void> {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:${command}`);
	await browser.$(`button=${button}`).waitForExist();
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
	await browser.pause(500);
}

describe('Maintenance during a run', () => {
	it('Clear local index stops the run, and the next index makes search work again', async () => {
		await useMockTopK();
		await confirmDuringRun('clear-local-index', 'Clear');
		await indexVault();
		expect(await indexedCount()).toBe(4);
		const { rows, status } = await searchRows(HERO_QUERY);
		expect(rows[0] ?? status).toContain('talk.pdf');
	});

	it('Remove my data leaves nothing searchable', async () => {
		await useMockTopK();
		await confirmDuringRun('remove-data-from-topk', 'Remove');
		expect(await indexedCount()).toBe(0);
		const { rows, status } = await searchRows(HERO_QUERY);
		expect(rows).toEqual([]);
		expect(status).toContain('Nothing is indexed yet');
	});
});

describe('Remove my data, then a restart', () => {
	it('does not upload again on its own', async () => {
		await useMockTopK({ autoIndex: true });
		await indexVault();
		await browser.executeObsidianCommand(`${PLUGIN_ID}:remove-data-from-topk`);
		await browser.$('button=Remove').click();
		await browser.waitUntil(async () => (await indexedCount()) === 0, { timeout: 10_000 });
		// What onLayoutReady does on every start, and what a file change does.
		await browser.executeObsidian(({ plugins }) => {
			(
				plugins.topkVisualSearch as unknown as { scheduler: { request(): void } }
			).scheduler.request();
		});
		await browser.pause(8_000);
		await browser.waitUntil(async () => !(await isIndexing()), { timeout: 60_000 });
		expect(await indexedCount()).toBe(0);
		const consent = await browser.executeObsidian(
			({ plugins }) =>
				(plugins.topkVisualSearch as unknown as { settings: { uploadConsent: boolean } })
					.settings.uploadConsent,
		);
		expect(consent).toBe(false);
	});
});
