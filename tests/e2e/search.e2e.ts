import { browser, expect } from '@wdio/globals';
import { activeView, indexVault, PLUGIN_ID, useMockTopK } from './helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';

describe('Visual search', () => {
	before(async () => {
		await useMockTopK();
		await indexVault();
	});

	it('finds the hero page and opens the PDF on that page', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:visual-search`);
		const input = browser.$('.topk-search-input');
		await input.waitForExist();
		await input.setValue(HERO_QUERY);
		await browser.keys('Enter');

		const first = browser.$('.topk-result[data-rank="1"]');
		await first.waitForExist({ timeout: 20_000 });
		await expect(first).toHaveText(expect.stringContaining('talk.pdf'));
		await expect(first).toHaveText(expect.stringContaining('Page 3'));
		// The snippet comes from the local text layer.
		await expect(first.$('.topk-result-snippet')).toHaveText(
			expect.stringContaining('Reranker architecture'),
		);
		await expect(browser.$$('.topk-result')).toBeElementsArrayOfSize({ lte: 10 });

		await first.click();
		await browser.waitUntil(async () => (await activeView()).page === 3, {
			timeout: 20_000,
			timeoutMsg: 'PDF did not open on page 3',
		});
		expect(await activeView()).toEqual({ type: 'pdf', file: 'Talks/talk.pdf', page: 3 });
	});

	it('saves the results as a note of page links', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:save-results-as-note`);
		await browser.waitUntil(async () => (await activeView()).type === 'markdown', {
			timeout: 10_000,
		});
		const note = await browser.executeObsidian(async ({ app }) => {
			const file = app.workspace.getActiveFile();
			return file ? { path: file.path, text: await app.vault.read(file) } : null;
		});
		expect(note?.path).toBe('Visual search - slide with the reranker architecture diagram.md');
		expect(note?.text).toContain('1. [[Talks/talk.pdf#page=3]] (page 3)');
	});
});
