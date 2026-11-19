// docs/qa/beta-1-findings.md F7: results for files whose names contain "#", "|", "^", "[" or "]".
import { browser, expect } from '@wdio/globals';
import { activeView, indexVault, PLUGIN_ID, useMockTopK } from '../helpers';
import { markdownFiles, searchRows } from './qa-helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';
const WEIRD = 'Talks/Q3 #1 review.pdf';

describe('QA: special characters in file names', () => {
	before(async () => {
		await useMockTopK();
		await browser.executeObsidian(async ({ app }, to: string) => {
			const file = app.vault.getFileByPath('Talks/talk.pdf');
			if (!file) throw new Error('missing talk.pdf');
			await app.vault.rename(file, to);
		}, WEIRD);
		await indexVault();
	});

	it('opens a result for "Q3 #1 review.pdf" at its page without creating notes', async () => {
		const before = await markdownFiles();
		const { rows } = await searchRows(HERO_QUERY);
		expect(rows[0]).toContain('Q3 #1 review.pdf');
		await browser.$('.topk-result[data-rank="1"]').click();
		await browser.pause(3_000);
		const view = await activeView();
		const after = await markdownFiles();
		console.log(
			'QA F7 open:',
			JSON.stringify({ view, created: after.filter((p) => !before.includes(p)) }),
		);
		expect(after).toEqual(before);
		expect(view).toEqual({ type: 'pdf', file: WEIRD, page: 3 });
	});

	it('saves results as a note whose links resolve', async () => {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:save-results-as-note`);
		await browser.waitUntil(async () => (await activeView()).type === 'markdown', {
			timeout: 10_000,
		});
		await browser.pause(1_500); // metadata cache
		const out = await browser.executeObsidian(async ({ app }) => {
			const file = app.workspace.getActiveFile();
			if (!file) return null;
			const unresolved = app.metadataCache.unresolvedLinks[file.path] ?? {};
			return { text: await app.vault.read(file), unresolved: Object.keys(unresolved) };
		});
		console.log('QA F7 note:', JSON.stringify(out));
		expect(out?.unresolved).toEqual([]);
	});

	it('wikilinks for names with "|", "^" and "[ ]" resolve to the file', async () => {
		const names = ['Docs/a|b.pdf', 'Docs/v2^final.pdf', 'Docs/[draft] plan.pdf'];
		const created = await browser.executeObsidian(async ({ app }, list: string[]) => {
			const source = app.vault.getFileByPath('Docs/handbook.pdf');
			if (!source) throw new Error('missing handbook');
			const data = await app.vault.readBinary(source);
			const ok: string[] = [];
			for (const name of list) {
				try {
					await app.vault.createBinary(name, data);
					ok.push(name);
				} catch {
					// Not creatable on this platform.
				}
			}
			// The exact text resultsNote() writes for each: wikiLink() = [[path#page=N]].
			const body = ok.map((name, i) => `${i + 1}. [[${name}#page=2]] (page 2)`).join('\n');
			await app.vault.create('QA links.md', body);
			return ok;
		}, names);
		await browser.pause(1_500);
		const unresolved = await browser.executeObsidian(({ app }) =>
			Object.keys(app.metadataCache.unresolvedLinks['QA links.md'] ?? {}),
		);
		console.log('QA F7 wikilinks:', JSON.stringify({ created, unresolved }));
		expect(unresolved).toEqual([]);
	});
});
