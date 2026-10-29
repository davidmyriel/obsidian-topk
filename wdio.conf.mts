import * as path from 'node:path';
import { build } from 'esbuild';

const root = import.meta.dirname;
const cacheDir = path.resolve(root, '.obsidian-cache');
export const probeBundle = path.join(cacheDir, 'e2e-probe.cjs');

// minAppVersion is the floor we promise; latest catches regressions (ADR-004).
const versions: [app: string, installer: string][] = [
	['earliest', 'earliest'],
	['latest', 'latest'],
];
const only = process.env.OBSIDIAN_VERSIONS; // e.g. "latest" to run one version locally

export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./tests/e2e/**/*.e2e.ts'],
	maxInstances: 1,
	capabilities: versions
		.filter(([app]) => !only || only.split(',').includes(app))
		.map(([app, installer]) => ({
			browserName: 'obsidian',
			browserVersion: app,
			'wdio:obsidianOptions': {
				installerVersion: installer,
				plugins: [root],
				vault: path.join(root, 'tests', 'fixtures', 'vault'),
			},
		})),
	services: ['obsidian'],
	reporters: ['spec'],
	cacheDir,
	mochaOpts: { ui: 'bdd', timeout: 120_000 },
	logLevel: 'warn',
	onPrepare: async () => {
		await build({
			entryPoints: [path.join(root, 'tests', 'e2e', 'probe', 'probe.ts')],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			target: 'es2021',
			external: ['electron', 'obsidian'],
			outfile: probeBundle,
			logLevel: 'warning',
		});
	},
};
