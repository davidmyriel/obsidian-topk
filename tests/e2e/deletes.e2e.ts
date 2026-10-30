import { browser, expect } from '@wdio/globals';
import { indexState, indexVault, PLUGIN_ID, useMockTopK } from './helpers';

const pageTotal = async (): Promise<number> =>
	Object.values((await indexState()).hashes).reduce((sum, h) => sum + h.pageCount, 0);

describe('Deletes', () => {
	before(async () => {
		await useMockTopK();
		await indexVault();
	});

	it('removes a deleted file from the index on the next run', async () => {
		expect(await pageTotal()).toBe(20);
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Talks/talk.pdf');
			if (file) await app.vault.delete(file);
		});
		await indexVault();
		expect(await pageTotal()).toBe(17);
	});

	it('removes this vault from TopK after confirmation', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:remove-data-from-topk`);
		const remove = browser.$('button=Remove');
		await remove.waitForExist();
		await remove.click();
		await browser.waitUntil(async () => (await pageTotal()) === 0, { timeout: 10_000 });

		await browser.executeObsidianCommand(`${PLUGIN_ID}:visual-search`);
		await browser.$('.topk-search-input').setValue('anything');
		await browser.keys('Enter');
		await expect(browser.$('.topk-search-status')).toHaveText(
			expect.stringContaining('Nothing is indexed yet'),
		);
		await browser.keys('Escape');
	});
});
