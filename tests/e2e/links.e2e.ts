// File names with # or |, renames and deletes: results open the right page, never create notes,
// and saved links resolve. Adapted from the outside tester's reproductions (beta 1 F7, F8).
import { browser, expect } from '@wdio/globals';
import { activeView, indexVault, PLUGIN_ID, useMockTopK } from './helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';

const markdownFiles = (): Promise<string[]> =>
	browser.executeObsidian(({ app }) =>
		app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.sort(),
	);

async function search(query: string): Promise<string[]> {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:visual-search`);
	await browser.$('.topk-search-input').setValue(query);
	await browser.keys('Enter');
	await browser.$('.topk-result[data-rank="1"]').waitForExist({ timeout: 20_000 });
	return browser.$$('.topk-result .topk-result-meta').map((e) => e.getText());
}

const rename = async (from: string, to: string): Promise<void> => {
	await browser.executeObsidian(
		async ({ app }, a: string, b: string) => {
			const file = app.vault.getAbstractFileByPath(a);
			if (!file) throw new Error(`missing ${a}`);
			await app.vault.rename(file, b);
		},
		from,
		to,
	);
};

describe('Results for unusual names, renames and deletes', () => {
	before(async () => {
		await useMockTopK();
		await indexVault();
	});

	it('follows a rename immediately, before any re-index', async () => {
		await rename('Talks', 'Archive');
		const meta = await search(HERO_QUERY);
		expect(meta[0]).toContain('Archive/talk.pdf');
		expect(meta.join('\n')).not.toContain('Talks/');
		await browser.keys('Escape');
	});

	it('opens "Q3 #1 review.pdf" at page 3 and creates no notes', async () => {
		await rename('Archive/talk.pdf', 'Archive/Q3 #1 review.pdf');
		const before = await markdownFiles();
		const meta = await search(HERO_QUERY);
		expect(meta[0]).toContain('Q3 #1 review.pdf');
		await browser.$('.topk-result[data-rank="1"]').click();
		await browser.waitUntil(async () => (await activeView()).page === 3, { timeout: 20_000 });
		expect(await activeView()).toEqual({
			type: 'pdf',
			file: 'Archive/Q3 #1 review.pdf',
			page: 3,
		});
		expect(await markdownFiles()).toEqual(before);
	});

	it('saves results as a note whose links all resolve', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:save-results-as-note`);
		await browser.waitUntil(async () => (await activeView()).type === 'markdown', {
			timeout: 10_000,
		});
		await browser.pause(1_500); // metadata cache
		const unresolved = await browser.executeObsidian(({ app }) => {
			const file = app.workspace.getActiveFile();
			return file
				? Object.keys(app.metadataCache.unresolvedLinks[file.path] ?? {})
				: ['no file'];
		});
		expect(unresolved).toEqual([]);
	});

	it('drops a deleted file from results instead of creating a note for it', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Archive/Q3 #1 review.pdf');
			if (file) await app.vault.delete(file);
		});
		const before = await markdownFiles();
		const meta = await search(HERO_QUERY);
		expect(meta.join('\n')).not.toContain('Q3 #1 review.pdf');
		await browser.$('.topk-result[data-rank="1"]').click();
		await browser.pause(1_000);
		expect(await markdownFiles()).toEqual(before);
	});
});
