import { browser } from '@wdio/globals';

export const PLUGIN_ID = 'topk-visual-search';

/** Points the plugin at the mock TopK started in wdio.conf.mts, with its key in secret storage. */
export async function useMockTopK(options: { uploadConsent?: boolean } = {}): Promise<void> {
	const origin = process.env.MOCK_TOPK_ORIGIN;
	if (!origin) throw new Error('MOCK_TOPK_ORIGIN not set; run through wdio.conf.mts');
	await browser.executeObsidian(
		async ({ app, plugins }, endpoint: string, consent: boolean) => {
			app.secretStorage.setSecret('topk-e2e', 'e2e-key');
			const plugin = plugins.topkVisualSearch as unknown as {
				settings: Record<string, unknown>;
				saveSettings(): Promise<void>;
			};
			Object.assign(plugin.settings, {
				apiKeySecret: 'topk-e2e',
				endpoint,
				collection: `e2e-${Math.random().toString(36).slice(2, 8)}`,
				longSide: 1024,
				uploadConsent: consent,
			});
			await plugin.saveSettings();
		},
		origin,
		options.uploadConsent ?? true,
	);
}

type SavedState = { hashes: Record<string, { status: string; pageCount: number }> };

/** Reads the plugin's saved index state. */
export async function indexState(): Promise<SavedState> {
	// executeObsidian's type does not unwrap an async callback; await flattens it at runtime.
	const state = await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.topkVisualSearch as unknown as {
			stateStore: { load(): Promise<SavedState> };
		};
		return plugin.stateStore.load();
	});
	return state;
}

export function isIndexing(): Promise<boolean> {
	return browser.executeObsidian(({ plugins }) => {
		return (plugins.topkVisualSearch as unknown as { indexer: { running: boolean } }).indexer
			.running;
	});
}
