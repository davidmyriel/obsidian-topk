import { describe, expect, it } from 'vitest';
import { compileFilter, globToRegExp, parseList } from '../../src/indexer/globs';
import { emptyState, parseState, pathsByHash, STATE_VERSION } from '../../src/indexer/state';
import { sourceKind } from '../../src/render/pageSource';

describe('globToRegExp', () => {
	it.each([
		['.obsidian/**', '.obsidian/plugins/x/main.js', true],
		['.obsidian/**', 'notes/.obsidian/x', false],
		['**/*.pdf', 'a.pdf', true],
		['**/*.pdf', 'a/b/c.pdf', true],
		['*.pdf', 'a/b.pdf', false],
		['Private/**', 'Private/tax.pdf', true],
		['Private/**', 'PrivateNotes/x.pdf', false],
		['scan-??.png', 'scan-01.png', true],
		['scan-??.png', 'scan-1.png', false],
		['a+b (1).pdf', 'a+b (1).pdf', true],
	])('%s on %s is %s', (glob, path, expected) => {
		expect(globToRegExp(glob).test(path)).toBe(expected);
	});
});

describe('compileFilter', () => {
	it('applies include folders, then exclude globs', () => {
		const include = compileFilter({
			includeFolders: ['Docs/', '/Talks'],
			excludeGlobs: ['**/draft-*'],
		});
		expect(include('Docs/a.pdf')).toBe(true);
		expect(include('Talks/x/y.pdf')).toBe(true);
		expect(include('Docs/draft-1.pdf')).toBe(false);
		expect(include('DocsOld/a.pdf')).toBe(false);
		expect(include('a.pdf')).toBe(false);
	});

	it('includes everything without include folders', () => {
		const include = compileFilter({
			includeFolders: [],
			excludeGlobs: ['.obsidian/**', '.trash/**'],
		});
		expect(include('a.pdf')).toBe(true);
		expect(include('.trash/a.pdf')).toBe(false);
	});

	it('parses settings lists', () => {
		expect(parseList(' a/**, b \n\n c ')).toEqual(['a/**', 'b', 'c']);
	});
});

describe('index state', () => {
	const stored = {
		version: STATE_VERSION,
		vaultId: 'v1',
		collection: 'c1',
		lastLsn: '7',
		files: {
			'a.pdf': { hash: 'h1', size: 1, mtime: 2 },
			'b.pdf': { hash: 'h1', size: 1, mtime: 3 },
			bad: { hash: 1 },
		},
		hashes: {
			h1: {
				kind: 'pdf',
				extension: 'pdf',
				pageCount: 2,
				ids: ['h1:1:0', 'h1:2:0'],
				status: 'indexed',
				updatedAt: 5,
			},
			h2: { kind: 'video', extension: 'mp4', pageCount: 1, ids: [], status: 'indexed' },
		},
	};

	it('round-trips through JSON and drops malformed entries', () => {
		const state = parseState(JSON.parse(JSON.stringify(stored)), () => 'new', 'c1');
		expect(state.vaultId).toBe('v1');
		expect(Object.keys(state.files)).toEqual(['a.pdf', 'b.pdf']);
		expect(Object.keys(state.hashes)).toEqual(['h1']);
		expect(state.lastLsn).toBe('7');
		expect(parseState(JSON.parse(JSON.stringify(state)), () => 'new', 'c1')).toEqual(state);
	});

	it('starts fresh on garbage or another version, keeping nothing', () => {
		expect(parseState(null, () => 'new', 'c1')).toEqual(emptyState('new', 'c1'));
		expect(parseState({ ...stored, version: 99 }, () => 'new', 'c1').vaultId).toBe('new');
	});

	it('forgets uploads when the collection changes but keeps the vault id and file hashes', () => {
		const state = parseState(stored, () => 'new', 'c2');
		expect(state.vaultId).toBe('v1');
		expect(state.hashes).toEqual({});
		expect(state.lastLsn).toBeUndefined();
		expect(Object.keys(state.files)).toHaveLength(2);
	});

	it('groups paths by hash', () => {
		const state = parseState(stored, () => 'new', 'c1');
		expect(pathsByHash(state).get('h1')).toEqual(['a.pdf', 'b.pdf']);
	});
});

it('recognises supported file types', () => {
	expect(['pdf', 'PDF', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'md'].map(sourceKind)).toEqual([
		'pdf',
		'pdf',
		'image',
		'image',
		'image',
		'image',
		null,
		null,
	]);
});
