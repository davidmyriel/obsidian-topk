import { browser, expect } from '@wdio/globals';
import { indexState, isIndexing, PLUGIN_ID, useMockTopK } from './helpers';

describe('Index vault', () => {
	it('asks before the first upload, then indexes all 20 fixture pages', async () => {
		await useMockTopK({ uploadConsent: false });
		await browser.executeObsidianCommand(`${PLUGIN_ID}:index-vault`);

		const start = browser.$('button=Start indexing');
		await start.waitForExist({ timeout: 30_000 });
		await expect(browser.$('.modal')).toHaveText(expect.stringContaining('20 pages'));
		await expect(browser.$('.modal')).toHaveText(
			expect.stringContaining('Estimated TopK cost'),
		);
		await start.click();

		await browser.waitUntil(async () => !(await isIndexing()), {
			timeout: 60_000,
			timeoutMsg: 'indexing did not finish',
		});
		const state = await indexState();
		const entries = Object.values(state.hashes);
		expect(entries).toHaveLength(4);
		expect(entries.every((h) => h.status === 'indexed')).toBe(true);
		expect(entries.reduce((sum, h) => sum + h.pageCount, 0)).toBe(20);
	});
});
