// Downloads the benchmark corpus listed in bench/corpus.json into bench/corpus/ and checks every
// file against its recorded SHA-256. Files already present and intact are not downloaded again.
//
//   npm run bench:fetch            download missing files, fail on any hash mismatch
//   npm run bench:fetch -- --record  also fill in sha256, bytes and pages for new entries
//
// The files are not committed: each keeps its own licence (recorded per entry) and comes from its
// original source.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { countPages, sourceKind } from '../src/render/pageSource';
import { nodeRenderEnv } from '../tests/support/nodeVault';
import { CORPUS_DIR, CORPUS_JSON, readCorpus } from './corpus';

const USER_AGENT = 'obsidian-topk-bench/0.1 (benchmark corpus fetcher)';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** GET with retries on 429 and 5xx, waiting as long as the server's Retry-After asks. */
async function download(url: string): Promise<Uint8Array> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
		if (res.ok) return new Uint8Array(await res.arrayBuffer());
		await res.body?.cancel();
		if ((res.status === 429 || res.status >= 500) && attempt < 8) {
			const after = Number(res.headers.get('retry-after'));
			const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 5000;
			process.stdout.write(`HTTP ${res.status}, waiting ${Math.round(wait / 1000)} s … `);
			await sleep(wait);
			continue;
		}
		throw new Error(`${url}: HTTP ${res.status}`);
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({ options: { record: { type: 'boolean', default: false } } });
	const corpus = readCorpus();
	let fetched = 0;
	let changed = false;
	const problems: string[] = [];
	let lastHost = '';
	for (const entry of corpus.files) {
		const dest = join(CORPUS_DIR, entry.file);
		let bytes: Uint8Array | null = existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null;
		if (bytes && entry.sha256 && sha256(bytes) !== entry.sha256) bytes = null; // re-download
		let downloaded = false;
		if (!bytes) {
			// arXiv asks for one request every few seconds; be as polite everywhere.
			const host = new URL(entry.url).host;
			if (host === lastHost) await sleep(3000);
			lastHost = host;
			process.stdout.write(`fetch ${entry.file} … `);
			try {
				bytes = await download(entry.url);
			} catch (err) {
				console.log('failed');
				problems.push(String(err));
				continue;
			}
			console.log(`${Math.round(bytes.length / 1024)} KB`);
			downloaded = true;
			fetched++;
		}
		const hash = sha256(bytes);
		if (entry.sha256 && entry.sha256 !== hash) {
			problems.push(`${entry.file}: SHA-256 ${hash} does not match ${entry.sha256}`);
			continue;
		}
		if (downloaded) {
			mkdirSync(dirname(dest), { recursive: true });
			writeFileSync(`${dest}.part`, bytes);
			renameSync(`${dest}.part`, dest);
		}
		if (values.record && (!entry.sha256 || entry.pages === undefined)) {
			const extension = entry.file.slice(entry.file.lastIndexOf('.') + 1);
			const kind = sourceKind(extension);
			if (!kind) throw new Error(`${entry.file}: unsupported file type`);
			entry.sha256 = hash;
			entry.bytes = bytes.length;
			entry.pages = await countPages(nodeRenderEnv, kind, bytes);
			changed = true;
		} else if (!entry.sha256) {
			problems.push(`${entry.file}: no sha256 recorded; run with --record`);
		}
	}
	if (changed) writeFileSync(CORPUS_JSON, `${JSON.stringify(corpus, null, '\t')}\n`);
	const pages = corpus.files.reduce((n, f) => n + (f.pages ?? 0), 0);
	console.log(
		`${corpus.files.length} files, ${pages} pages; downloaded ${fetched}${changed ? '; corpus.json updated' : ''}.`,
	);
	if (problems.length > 0) {
		console.error(problems.join('\n'));
		process.exitCode = 1;
	}
}

await main();
