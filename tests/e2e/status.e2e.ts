import { browser, expect } from '@wdio/globals';
import { indexVault, isIndexing, PLUGIN_ID, useMockTopK } from './helpers';

describe('Index status', () => {
	it('lists a broken PDF as failed and offers Retry', async () => {
		await useMockTopK();
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('broken.pdf', 'not a pdf');
		});
		await indexVault();

		await browser.executeObsidianCommand(`${PLUGIN_ID}:show-index-status`);
		const modal = browser.$('.modal');
		await expect(modal).toHaveText(expect.stringContaining('4 files and 20 pages indexed'));
		await expect(modal).toHaveText(expect.stringContaining('Failed (1)'));
		await expect(modal).toHaveText(expect.stringContaining('broken.pdf'));

		await browser.$('button=Retry failed').click();
		await browser.waitUntil(async () => !(await isIndexing()), { timeout: 30_000 });
		// Still broken, still listed.
		await browser.executeObsidianCommand(`${PLUGIN_ID}:show-index-status`);
		await expect(browser.$('.modal')).toHaveText(expect.stringContaining('Failed (1)'));
		await browser.keys('Escape');
	});
});
