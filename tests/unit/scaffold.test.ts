import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

function tsFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return tsFiles(path);
		return path.endsWith('.ts') ? [path] : [];
	});
}

describe('scaffold', () => {
	it('keeps obsidian imports out of the core modules', () => {
		const offenders = ['indexer', 'render', 'topk']
			.flatMap((dir) => tsFiles(join(root, 'src', dir)))
			.filter((file) =>
				/from\s+['"]obsidian['"]|require\(['"]obsidian['"]\)/.test(
					readFileSync(file, 'utf8'),
				),
			);
		expect(offenders).toEqual([]);
	});

	it('is desktop only and lists its version in versions.json', () => {
		const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
			version: string;
			minAppVersion: string;
			isDesktopOnly: boolean;
		};
		const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8')) as Record<
			string,
			string
		>;
		expect(manifest.isDesktopOnly).toBe(true);
		expect(versions[manifest.version]).toBe(manifest.minAppVersion);
	});
});
