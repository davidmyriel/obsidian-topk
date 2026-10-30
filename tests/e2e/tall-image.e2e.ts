import { browser, expect } from '@wdio/globals';
import { indexState, indexVault, useMockTopK } from './helpers';

describe('Tall images', () => {
	it('indexes a long screenshot as several tiles in Obsidian', async () => {
		await useMockTopK();
		await browser.executeObsidian(async ({ app }) => {
			const canvas = createEl('canvas', { attr: { width: 900, height: 4000 } });
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no 2d context');
			['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'].forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(0, i * 1000, 900, 1000);
			});
			const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
			if (!blob) throw new Error('encode failed');
			await app.vault.createBinary('long-screenshot.png', await blob.arrayBuffer());
		});
		await indexVault();
		const entry = await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.topkVisualSearch as unknown as {
				stateStore: {
					load(): Promise<{
						files: Record<string, { hash: string }>;
						hashes: Record<string, { status: string; pageCount: number }>;
					}>;
				};
			};
			const state = await plugin.stateStore.load();
			return state.hashes[state.files['long-screenshot.png']?.hash ?? ''] ?? null;
		});
		// 900x4000: tiles of 900x1273 with 10% overlap -> 4 tiles.
		expect(entry).toEqual(expect.objectContaining({ status: 'indexed', pageCount: 4 }));
		const state = await indexState();
		expect(Object.values(state.hashes).every((h) => h.status === 'indexed')).toBe(true);
	});
});
