// docs/qa/beta-1-findings.md F8: search shows paths from the last index run, not the vault.
import { browser, expect } from '@wdio/globals';
import { activeView, indexVault, useMockTopK } from '../helpers';
import { markdownFiles, searchRows } from './qa-helpers';

const HERO_QUERY = 'slide with the reranker architecture diagram';

describe('QA: renamed file before the next index run', () => {
	before(async () => {
		await useMockTopK({ autoIndex: false });
		await indexVault();
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Talks/talk.pdf');
			if (!file) throw new Error('missing talk.pdf');
			await app.vault.rename(file, 'Talks/renamed talk.pdf');
		});
	});

	it('opens the renamed PDF at the page and creates nothing', async () => {
		const before = await markdownFiles();
		const filesBefore = await browser.executeObsidian(({ app }) => app.vault.getFiles().length);
		const { rows } = await searchRows(HERO_QUERY);
		console.log('QA F8 rows:', JSON.stringify(rows.slice(0, 2)));
		await browser.$('.topk-result[data-rank="1"]').click();
		await browser.pause(3_000);
		const view = await activeView();
		const after = await markdownFiles();
		const filesAfter = await browser.executeObsidian(({ app }) =>
			app.vault.getFiles().map((f) => f.path),
		);
		console.log(
			'QA F8 open:',
			JSON.stringify({
				view,
				created: after.filter((p) => !before.includes(p)),
				filesBefore,
				filesAfter: filesAfter.length,
			}),
		);
		expect(rows[0]).toContain('renamed talk.pdf');
		expect(view).toEqual({ type: 'pdf', file: 'Talks/renamed talk.pdf', page: 3 });
		expect(filesAfter.length).toBe(filesBefore);
	});
});
