import { browser } from '@wdio/globals';
import { PLUGIN_ID } from '../helpers';

/** Runs a visual search in the modal and returns the result rows' text (empty if none). */
export async function searchRows(query: string): Promise<{ rows: string[]; status: string }> {
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
	return { rows, status };
}

/** All markdown file paths in the vault. */
export function markdownFiles(): Promise<string[]> {
	return browser.executeObsidian(({ app }) =>
		app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.sort(),
	);
}

export async function indexedCount(): Promise<number> {
	// executeObsidian's type does not unwrap an async callback; await flattens it at runtime.
	const count = await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.topkVisualSearch as unknown as {
			stateStore: { load(): Promise<{ hashes: Record<string, { status: string }> }> };
		};
		const state = await plugin.stateStore.load();
		return Object.values(state.hashes).filter((h) => h.status === 'indexed').length;
	});
	return count;
}
