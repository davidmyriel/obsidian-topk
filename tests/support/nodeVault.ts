// A VaultReader over a folder on disk, plus a RenderEnv for Node.
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VaultFile, VaultReader } from '../../src/indexer/indexer';
import type { RenderEnv } from '../../src/render/pageSource';
import { listFixtureFiles, FIXTURE_VAULT } from './fixtures';
import {
	loadNodePdfJs,
	nodeCanvasFactory,
	nodeDecodeImage,
	nodeDocumentOptions,
} from './node-render';

export class DiskVault implements VaultReader {
	reads = 0;
	constructor(readonly root: string) {}

	list(): VaultFile[] {
		return listFixtureFiles(this.root).map((path) => {
			const st = statSync(join(this.root, path));
			return {
				path,
				extension: path.slice(path.lastIndexOf('.') + 1),
				size: st.size,
				mtime: st.mtimeMs,
			};
		});
	}

	read(path: string): Promise<Uint8Array> {
		this.reads++;
		return Promise.resolve(new Uint8Array(readFileSync(join(this.root, path))));
	}
}

/** Copies the fixture vault to a temp folder the test may change. */
export function tempVault(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'topk-vault-'));
	cpSync(FIXTURE_VAULT, root, { recursive: true });
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const nodeRenderEnv: RenderEnv = {
	loadPdfJs: loadNodePdfJs,
	createCanvas: nodeCanvasFactory,
	decodeImage: nodeDecodeImage,
	documentOptions: nodeDocumentOptions,
};
