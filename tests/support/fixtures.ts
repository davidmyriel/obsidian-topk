// Helpers for the generated fixture vault in tests/fixtures/vault.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { labelScorer, type FakeScorer } from '../../src/topk/fake';
import { sha256Hex } from '../../src/util/hash';

export const FIXTURE_VAULT = join(import.meta.dirname, '..', 'fixtures', 'vault');
const labels = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'fixtures', 'labels.json'), 'utf8'),
) as Record<string, string>;

export const HERO_QUERY = 'slide with the reranker architecture diagram';
export const HERO = { path: 'Talks/talk.pdf', page: 3 };

export function listFixtureFiles(root = FIXTURE_VAULT): string[] {
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			const full = join(dir, name);
			return statSync(full).isDirectory()
				? walk(full)
				: [relative(root, full).split(sep).join('/')];
		});
	return walk(root).sort();
}

/** A FakeTopK scorer that ranks fixture pages by word overlap with their labels. */
export async function fixtureScorer(root = FIXTURE_VAULT): Promise<FakeScorer> {
	const byHash: Record<string, string> = {};
	for (const [key, label] of Object.entries(labels)) {
		const [path, page] = key.split('#');
		if (!path || !page) continue;
		const hash = await sha256Hex(new Uint8Array(readFileSync(join(root, path))));
		byHash[`${hash}:${page}`] = label;
	}
	return labelScorer(byHash);
}

export const FIXTURE_PAGE_COUNT = Object.keys(labels).length;
