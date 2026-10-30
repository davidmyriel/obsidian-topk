import { browser, expect } from '@wdio/globals';
import { indexState, indexVault, useMockTopK } from './helpers';

const paths = async (): Promise<string[]> =>
	browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.topkVisualSearch as unknown as {
			stateStore: { load(): Promise<{ files: Record<string, unknown> }> };
		};
		return Object.keys((await plugin.stateStore.load()).files).sort();
	});

describe('Index automatically', () => {
	before(async () => {
		await useMockTopK({ autoIndex: true });
		await indexVault();
	});

	it('picks up an added file and a deleted file without running Index vault', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const source = app.vault.getFileByPath('Talks/talk.pdf');
			if (!source) throw new Error('missing talk.pdf');
			await app.vault.createBinary('Talks/talk copy.pdf', await app.vault.readBinary(source));
			const photo = app.vault.getFileByPath('Photos/sunset.webp');
			if (photo) await app.vault.delete(photo);
		});
		// 5 s debounce plus the run itself.
		await browser.waitUntil(
			async () => {
				const p = await paths();
				return p.includes('Talks/talk copy.pdf') && !p.includes('Photos/sunset.webp');
			},
			{ timeout: 30_000, interval: 1_000, timeoutMsg: 'background index did not run' },
		);
		const pages = Object.values((await indexState()).hashes).reduce(
			(sum, h) => sum + h.pageCount,
			0,
		);
		// The copy shares talk.pdf's content, so it adds no pages; the photo's page is gone.
		expect(pages).toBe(19);
	});
});
