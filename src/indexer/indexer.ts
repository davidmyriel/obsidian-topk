import { pageId, TopKError, type PageDoc, type TopKClient } from '../topk/client';
import {
	countPages,
	pageImages,
	sourceKind,
	type RenderEnv,
	type SourceKind,
} from '../render/pageSource';
import { sha256Hex } from '../util/hash';
import { compileFilter, type PathFilter } from './globs';
import type { FileStamp, IndexState } from './state';

// The index pipeline: scan the vault, hash changed files, render pages of files whose content is
// not yet in TopK, and upload them. Runs without Obsidian; main.ts supplies the adapters.

export interface VaultFile {
	path: string;
	extension: string;
	size: number;
	mtime: number;
}

export interface VaultReader {
	list(): VaultFile[];
	read(path: string): Promise<Uint8Array>;
}

export interface IndexOptions extends PathFilter {
	maxPagesPerFile: number;
	longSide: number;
	/** JPEG quality, 0..1. */
	quality: number;
	/** TopK's per-image limit (ADR-002). */
	maxImageBytes: number;
	/** Upload once this many image bytes are buffered, to cap memory. */
	flushBytes: number;
}

export const DEFAULT_INDEX_OPTIONS: Omit<
	IndexOptions,
	keyof PathFilter | 'maxPagesPerFile' | 'longSide'
> = {
	quality: 0.85,
	maxImageBytes: 512 * 1024,
	flushBytes: 4 * 1024 * 1024,
};

export interface WorkItem {
	hash: string;
	/** First path with this content; others share the upload. */
	path: string;
	kind: SourceKind;
	extension: string;
	pageCount: number;
}

export interface IndexPlan {
	/** The files map after this scan: every included, supported file with its hash. */
	files: Record<string, FileStamp>;
	work: WorkItem[];
	totalPages: number;
	/** Included files whose content is already indexed. */
	unchanged: number;
	skipped: { path: string; reason: string; pageCount: number }[];
	failed: { path: string; reason: string }[];
	/** True when the scan was cancelled; the plan then covers only part of the vault. */
	cancelled: boolean;
}

export interface IndexProgress {
	phase: 'scanning' | 'uploading';
	done: number;
	total: number;
	path?: string;
}

export interface IndexSummary {
	filesIndexed: number;
	filesUnchanged: number;
	pagesUploaded: number;
	skipped: { path: string; reason: string }[];
	failed: { path: string; reason: string }[];
	cancelled: boolean;
}

export interface IndexDeps {
	reader: VaultReader;
	client: TopKClient;
	env: RenderEnv;
	state: IndexState;
	/** Persists the state; called after every file so a crash loses at most one file. */
	save: (state: IndexState) => Promise<void>;
	onProgress?: (progress: IndexProgress) => void;
	signal?: AbortSignal;
	now?: () => number;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Scans, hashes changed files and counts pages. Uploads nothing and does not touch TopK. */
export async function planIndex(
	deps: Pick<IndexDeps, 'reader' | 'env' | 'state' | 'onProgress' | 'signal'>,
	options: IndexOptions,
): Promise<IndexPlan> {
	const { reader, env, state } = deps;
	const include = compileFilter(options);
	const candidates = reader
		.list()
		.filter((f) => sourceKind(f.extension) !== null && include(f.path))
		.sort((a, b) => a.path.localeCompare(b.path));

	const files: Record<string, FileStamp> = {};
	const failed: IndexPlan['failed'] = [];
	for (const [i, file] of candidates.entries()) {
		if (deps.signal?.aborted) break;
		deps.onProgress?.({
			phase: 'scanning',
			done: i,
			total: candidates.length,
			path: file.path,
		});
		const known = state.files[file.path];
		if (known && known.size === file.size && known.mtime === file.mtime) {
			files[file.path] = known;
			continue;
		}
		try {
			const hash = await sha256Hex(await reader.read(file.path));
			files[file.path] = { hash, size: file.size, mtime: file.mtime };
		} catch (err) {
			failed.push({ path: file.path, reason: errorText(err) });
		}
	}

	const work: WorkItem[] = [];
	const skipped: IndexPlan['skipped'] = [];
	const seen = new Set<string>();
	let unchanged = 0;
	let totalPages = 0;
	for (const [path, stamp] of Object.entries(files)) {
		if (seen.has(stamp.hash)) continue; // identical content is stored once
		seen.add(stamp.hash);
		const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
		const kind = sourceKind(extension);
		if (!kind) continue;
		const entry = state.hashes[stamp.hash];
		if (entry?.status === 'indexed') {
			unchanged++;
			continue;
		}
		let pageCount = entry?.pageCount ?? 0;
		if (!entry || entry.status !== 'skipped') {
			try {
				// Images are one page; only PDFs need reading to count.
				pageCount =
					kind === 'image' ? 1 : await countPages(env, kind, await reader.read(path));
			} catch (err) {
				failed.push({ path, reason: errorText(err) });
				continue;
			}
		}
		if (pageCount > options.maxPagesPerFile) {
			skipped.push({
				path,
				pageCount,
				reason: `${pageCount} pages, over the limit of ${options.maxPagesPerFile}`,
			});
			continue;
		}
		work.push({ hash: stamp.hash, path, kind, extension, pageCount });
		totalPages += pageCount;
	}
	return {
		files,
		work,
		totalPages,
		unchanged,
		skipped,
		failed,
		cancelled: deps.signal?.aborted ?? false,
	};
}

/**
 * Indexes the vault. With nothing to upload it makes no TopK calls at all. A TopKError (bad key,
 * offline, wrong schema) stops the run after saving progress; other per-file errors are recorded
 * and the run continues.
 */
export async function runIndex(
	deps: IndexDeps,
	options: IndexOptions,
	plan?: IndexPlan,
): Promise<IndexSummary> {
	const { state, client } = deps;
	const now = deps.now ?? Date.now;
	plan ??= await planIndex(deps, options);
	const summary: IndexSummary = {
		filesIndexed: 0,
		filesUnchanged: plan.unchanged,
		pagesUploaded: 0,
		skipped: plan.skipped.map(({ path, reason }) => ({ path, reason })),
		failed: [...plan.failed],
		cancelled: false,
	};
	// A partial scan must not replace the files map, or unscanned files would look deleted.
	if (plan.cancelled) return { ...summary, cancelled: true };

	state.files = plan.files;
	for (const { path, reason, pageCount } of plan.skipped) {
		const stamp = plan.files[path];
		if (!stamp) continue;
		const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
		state.hashes[stamp.hash] = {
			kind: sourceKind(extension) ?? 'pdf',
			extension,
			pageCount,
			ids: [],
			status: 'skipped',
			reason,
			updatedAt: now(),
		};
	}
	if (plan.work.length === 0 || deps.signal?.aborted) {
		summary.cancelled = deps.signal?.aborted ?? false;
		await deps.save(state);
		return summary;
	}

	await client.ensureCollection();
	let done = 0;
	deps.onProgress?.({ phase: 'uploading', done, total: plan.totalPages });

	for (const item of plan.work) {
		if (deps.signal?.aborted) {
			summary.cancelled = true;
			break;
		}
		const ids: string[] = [];
		let buffer: PageDoc[] = [];
		let buffered = 0;
		const flush = async (): Promise<void> => {
			if (buffer.length === 0) return;
			const { lsn } = await client.upsertPages(buffer);
			if (lsn) state.lastLsn = lsn;
			for (const p of buffer) ids.push(p.id);
			summary.pagesUploaded += buffer.length;
			buffer = [];
			buffered = 0;
		};
		const record = (status: 'indexed' | 'partial' | 'failed', reason?: string): void => {
			state.hashes[item.hash] = {
				kind: item.kind,
				extension: item.extension,
				pageCount: item.pageCount,
				ids,
				status,
				...(reason ? { reason } : {}),
				updatedAt: now(),
			};
		};

		try {
			const data = await deps.reader.read(item.path);
			for await (const img of pageImages(deps.env, item.kind, item.extension, data, {
				longSide: options.longSide,
				quality: options.quality,
				maxBytes: options.maxImageBytes,
			})) {
				buffer.push({
					id: pageId(item.hash, img.page, img.tile),
					vaultId: state.vaultId,
					contentHash: item.hash,
					page: img.page,
					tile: img.tile,
					kind: item.kind === 'pdf' ? 'pdf_page' : 'image',
					image: { format: img.format, bytes: img.bytes },
				});
				buffered += img.bytes.length;
				deps.onProgress?.({
					phase: 'uploading',
					done: ++done,
					total: plan.totalPages,
					path: item.path,
				});
				if (buffered >= options.flushBytes) await flush();
				if (deps.signal?.aborted) break;
			}
			await flush();
			if (deps.signal?.aborted) {
				record('partial', 'cancelled');
				summary.cancelled = true;
			} else {
				record('indexed');
				summary.filesIndexed++;
			}
		} catch (err) {
			if (err instanceof TopKError) {
				record('partial', err.message);
				await deps.save(state);
				throw err;
			}
			record('failed', errorText(err));
			summary.failed.push({ path: item.path, reason: errorText(err) });
		}
		await deps.save(state);
		if (summary.cancelled) break;
	}
	return summary;
}
