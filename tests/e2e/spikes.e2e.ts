// Stage 0 spikes run inside a real Obsidian window. Opt in with E2E_SPIKES=1; they reach the
// public TopK endpoint, which the regular e2e suite must not do.
import * as path from 'node:path';
import { browser, expect } from '@wdio/globals';

const probe = path.resolve(import.meta.dirname, '..', '..', '.obsidian-cache', 'e2e-probe.cjs');
const run = process.env.E2E_SPIKES === '1' ? describe : describe.skip;

run('Stage 0 spikes in Obsidian', () => {
	it('spike A: the bundled gRPC transport reaches TopK from the renderer', async () => {
		const result = await browser.executeObsidian(async (_obs, probePath: string) => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- the probe is a prebuilt CJS file loaded at runtime
			const p = require(probePath) as typeof import('./probe/probe');
			return p.grpcProbe('aws-us-east-1-elastica');
		}, probe);
		console.log('[spike A in Obsidian]', JSON.stringify(result));
		// Without a key TopK answers INVALID_ARGUMENT "authorization header not provided".
		expect(result.code).toBe(3);
	});

	it('spike C: loadPdfJs renders the fixture talk at three resolutions', async () => {
		for (const longSide of [1024, 1536, 2048]) {
			const result = await browser.executeObsidian(
				async ({ app, obsidian }, probePath: string, size: number) => {
					// eslint-disable-next-line @typescript-eslint/no-require-imports -- the probe is a prebuilt CJS file loaded at runtime
					const p = require(probePath) as typeof import('./probe/probe');
					const file = app.vault.getFileByPath('Talks/talk.pdf');
					if (!file) throw new Error('fixture missing');
					const data = new Uint8Array(await app.vault.readBinary(file));
					const pdfjs = (await obsidian.loadPdfJs()) as Parameters<
						typeof p.renderProbe
					>[0] & { version?: string };
					return {
						pdfjsVersion: pdfjs.version,
						...(await p.renderProbe(pdfjs, data, size)),
					};
				},
				probe,
				longSide,
			);
			console.log(`[spike C in Obsidian ${longSide}]`, JSON.stringify(result));
			expect(result.pages.map((x) => x.page)).toEqual([1, 2, 3]);
			expect(result.pages[0]?.width).toBe(longSide);
		}
	});
});
