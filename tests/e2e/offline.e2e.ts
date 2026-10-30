import { browser, expect } from '@wdio/globals';
import { indexState, isIndexing, mockFail, PLUGIN_ID, statusBarText, useMockTopK } from './helpers';

describe('Index vault while TopK is unreachable', () => {
	it('pauses, then resumes when the connection comes back', async () => {
		await useMockTopK();
		// More failures than the client retries (3), so the run has to pause.
		await mockFail(8, 14, '/topk.data.v1.WriteService/UpsertDocuments');
		await browser.executeObsidianCommand(`${PLUGIN_ID}:index-vault`);

		await browser.waitUntil(async () => (await statusBarText()).includes('Offline'), {
			timeout: 30_000,
			timeoutMsg: 'never showed the offline pause',
		});
		// Simulate the network coming back; the mock has a few failures left, so it may pause again.
		for (let i = 0; i < 5 && (await isIndexing()); i++) {
			await browser.executeObsidian(() => window.dispatchEvent(new Event('online')));
			await browser.pause(1_000);
		}
		await browser.waitUntil(async () => !(await isIndexing()), {
			timeout: 60_000,
			timeoutMsg: 'did not finish',
		});

		const entries = Object.values((await indexState()).hashes);
		expect(entries.every((h) => h.status === 'indexed')).toBe(true);
		expect(entries.reduce((sum, h) => sum + h.pageCount, 0)).toBe(20);
	});
});
