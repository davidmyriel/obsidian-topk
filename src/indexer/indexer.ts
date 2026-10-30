import { pageId, type TopKClient } from '../topk/client';
import {
	countPages,
	pageImages,
	sourceKind,
	type RenderEnv,
	type SourceKind,
} from '../render/pageSource';
import { sha256Hex } from '../util/hash';
import { compileFilter, type PathFilter } from './globs';
import { Uploader } from './uploader';
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
	/** Upper bound on width × height of each uploaded page image (ADR-003). */
	maxPixels: number;
	/** JPEG quality, 0..1. */
	quality: number;
	/** TopK's per-image limit (ADR-002). */
	maxImageBytes: number;
	/** Upload once this many image bytes are buffered, to cap memory. */
	flushBytes: number;
	/** Upsert requests in flight at once. */
	concurrency: number;
}

export const DEFAULT_INDEX_OPTIONS: Omit<
	IndexOptions,
	keyof PathFilter | 'maxPagesPerFile' | 'maxPixels'
> = {
	quality: 0.85,
	maxImageBytes: 512 * 1024,
	flushBytes: 4 * 1024 * 1024,
	concurrency: 4,
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
 * Indexes the vault. With nothing to upload it makes no TopK calls at all. An upload error (bad
 * key, offline after retries, wrong schema) stops the run after saving progress; other per-file
 * errors are recorded and the run continues.
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

	// Per-file progress: a file is indexed once it is fully rendered and every batch holding one of
	// its pages has landed. Batches can mix pages from several files.
	interface FileJob {
		item: WorkItem;
		ids: string[];
		outstanding: number;
		rendered: boolean;
		failed: boolean;
	}
	const jobs = new Map<string, FileJob>();
	const record = (
		job: FileJob,
		status: 'indexed' | 'partial' | 'failed',
		reason?: string,
	): void => {
		state.hashes[job.item.hash] = {
			kind: job.item.kind,
			extension: job.item.extension,
			pageCount: job.item.pageCount,
			ids: [...job.ids],
			status,
			...(reason ? { reason } : {}),
			updatedAt: now(),
		};
	};
	// Saves are chained so concurrent batch completions never write the state out of order.
	let saving: Promise<void> = Promise.resolve();
	const save = (): Promise<void> => (saving = saving.then(() => deps.save(state)));
	const finishIfDone = (job: FileJob): void => {
		if (!job.rendered || job.outstanding > 0 || job.failed) return;
		record(job, 'indexed');
		summary.filesIndexed++;
		jobs.delete(job.item.hash);
		void save();
	};

	const uploader = new Uploader(client, options, (pages, lsn) => {
		if (lsn) state.lastLsn = lsn;
		summary.pagesUploaded += pages.length;
		for (const page of pages) {
			const job = jobs.get(page.contentHash);
			if (!job) continue;
			job.ids.push(page.id);
			job.outstanding--;
			finishIfDone(job);
		}
	});

	try {
		for (const item of plan.work) {
			if (deps.signal?.aborted) break;
			const job: FileJob = { item, ids: [], outstanding: 0, rendered: false, failed: false };
			jobs.set(item.hash, job);
			try {
				const data = await deps.reader.read(item.path);
				for await (const img of pageImages(deps.env, item.kind, item.extension, data, {
					maxPixels: options.maxPixels,
					quality: options.quality,
					maxBytes: options.maxImageBytes,
				})) {
					job.outstanding++;
					await uploader.add({
						id: pageId(item.hash, img.page, img.tile),
						vaultId: state.vaultId,
						contentHash: item.hash,
						page: img.page,
						tile: img.tile,
						kind: item.kind === 'pdf' ? 'pdf_page' : 'image',
						image: { format: img.format, bytes: img.bytes },
					});
					deps.onProgress?.({
						phase: 'uploading',
						done: ++done,
						total: plan.totalPages,
						path: item.path,
					});
					if (deps.signal?.aborted) break;
				}
				if (deps.signal?.aborted) break;
				job.rendered = true;
				finishIfDone(job);
			} catch (err) {
				if (err === uploader.error) throw err;
				job.failed = true;
				record(job, 'failed', errorText(err));
				summary.failed.push({ path: item.path, reason: errorText(err) });
				void save();
			}
		}
		if (deps.signal?.aborted) {
			summary.cancelled = true;
			await uploader.abandon();
		} else {
			await uploader.drain();
		}
	} catch (err) {
		await uploader.abandon();
		for (const job of jobs.values()) if (!job.failed) record(job, 'partial', errorText(err));
		await save();
		throw err;
	}
	// Files still open here were interrupted by cancel.
	for (const job of jobs.values()) if (!job.failed) record(job, 'partial', 'cancelled');
	await save();
	return summary;
}
