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
				maxPixels: 1_310_720,
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

/** Runs Index vault with consent already given and waits for it to finish. */
export async function indexVault(): Promise<void> {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:index-vault`);
	await browser.waitUntil(async () => !(await isIndexing()), {
		timeout: 60_000,
		timeoutMsg: 'indexing did not finish',
	});
}

/** The active view's type, file and, for PDFs, the page shown (internal API, test-only). */
export function activeView(): Promise<{ type: string; file: string | null; page: number | null }> {
	return browser.executeObsidian(({ app }) => {
		const leaf = app.workspace.getMostRecentLeaf();
		const view = leaf?.view as unknown as {
			getViewType(): string;
			file?: { path: string };
			viewer?: { child?: { pdfViewer?: { pdfViewer?: { currentPageNumber?: number } } } };
		};
		return {
			type: view?.getViewType() ?? '',
			file: view?.file?.path ?? null,
			page: view?.viewer?.child?.pdfViewer?.pdfViewer?.currentPageNumber ?? null,
		};
	});
}

/** Makes the mock TopK fail the next `times` requests to `path` (see mockTopkServer.ts). */
export async function mockFail(times: number, code: number, path: string): Promise<void> {
	const { connect } = await import('node:http2');
	const origin = process.env.MOCK_TOPK_ORIGIN ?? '';
	await new Promise<void>((resolve, reject) => {
		const session = connect(origin);
		const req = session.request({
			':method': 'POST',
			':path': `/mock/fail?times=${times}&code=${code}&path=${encodeURIComponent(path)}`,
		});
		req.on('response', () => undefined);
		req.on('end', () => {
			session.close();
			resolve();
		});
		req.on('error', reject);
		req.end();
		req.resume();
	});
}

export function statusBarText(): Promise<string> {
	return browser.executeObsidian(() => document.querySelector('.topk-status')?.textContent ?? '');
}
