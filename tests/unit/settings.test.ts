import { describe, expect, it } from 'vitest';
import {
	collectionNameError,
	defaultSettings,
	endpointError,
	loadSettings,
} from '../../src/settingsModel';

describe('settings validation', () => {
	it('uses the vault config folder in the default excludes', () => {
		expect(defaultSettings('.config').excludeGlobs).toEqual(['.config/**', '.trash/**']);
	});

	it('accepts valid stored settings', () => {
		const s = loadSettings(
			{
				apiKeySecret: 'topk-key',
				region: 'gcp-us-east4-aloe',
				endpoint: ' http://127.0.0.1:5000 ',
				collection: 'my_pages-2',
				includeFolders: ['Docs', ' '],
				excludeGlobs: ['Private/**'],
				maxPagesPerFile: 50,
				maxPixels: 655_360,
				debugLog: true,
				autoIndex: false,
				uploadConsent: true,
			},
			'.obsidian',
		);
		expect(s).toMatchObject({
			region: 'gcp-us-east4-aloe',
			endpoint: 'http://127.0.0.1:5000',
			collection: 'my_pages-2',
			includeFolders: ['Docs'],
			maxPagesPerFile: 50,
			maxPixels: 655_360,
			uploadConsent: true,
			autoIndex: false,
		});
	});

	it('falls back to defaults for invalid fields', () => {
		const s = loadSettings(
			{
				region: 'mars-1',
				endpoint: 'ftp://x',
				collection: 'has space',
				maxPagesPerFile: 0,
				maxPixels: 999,
				excludeGlobs: [1],
			},
			'.obsidian',
		);
		expect(s).toEqual(defaultSettings('.obsidian'));
		expect(loadSettings('garbage', '.obsidian')).toEqual(defaultSettings('.obsidian'));
	});

	it.each([
		['', 'Enter a collection name.'],
		['-lead', expect.stringContaining('letters') as unknown],
		['ok-name_1', null],
	])('collection name %j', (name, expected) => {
		expect(collectionNameError(name)).toEqual(expected);
	});

	it.each([
		['', null],
		['https://aws-us-east-1-elastica.api.topk.io', null],
		['http://127.0.0.1:50051', null],
		['http://localhost:50051', null],
		['http://[::1]:50051', null],
		['http://topk.example.com', expect.stringContaining('unencrypted') as unknown],
		['https://host/path', expect.stringContaining('origin') as unknown],
		['not a url', expect.stringContaining('full URL') as unknown],
	])('endpoint %j', (endpoint, expected) => {
		expect(endpointError(endpoint)).toEqual(expected);
	});
});
