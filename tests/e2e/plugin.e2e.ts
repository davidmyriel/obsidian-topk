import { browser, expect } from '@wdio/globals';

describe('Obsidian with the fixture vault', () => {
	it('loads the plugin and sees the fixture PDF', async () => {
		const state = await browser.executeObsidian(({ app, plugins }) => ({
			loaded: plugins.topkVisualSearch !== undefined,
			files: app.vault
				.getFiles()
				.map((f) => f.path)
				.sort(),
		}));
		expect(state.loaded).toBe(true);
		expect(state.files).toContain('Talks/talk.pdf');
	});
});
