import {
	FileSystemAdapter,
	loadPdfJs,
	Modal,
	normalizePath,
	Notice,
	Setting,
	type App,
} from 'obsidian';
import type TopKVisualSearchPlugin from './main';
import {
	DEFAULT_INDEX_OPTIONS,
	planIndex,
	runIndex,
	type IndexOptions,
	type IndexPlan,
	type VaultReader,
} from './indexer/indexer';
import { progressText, summaryText } from './indexer/progress';
import { runUntilDone } from './indexer/resilience';
import {
	bindToVault,
	loadState,
	renamePaths,
	resetUploads,
	type IndexState,
} from './indexer/state';
import { indexStatus } from './indexer/status';
import { costSentence } from './util/cost';
import type { PdfJsLike } from './render/pdfRenderer';
import type { RenderEnv } from './render/pageSource';
import { TopKError } from './topk/client';
import { domCanvasFactory, domDecodeImage } from './util/domCanvas';

// Obsidian side of indexing: adapters for the core pipeline, the state file, the status bar and
// the first-run confirmation.

export function vaultReader(app: App): VaultReader {
	return {
		list: () =>
			app.vault.getFiles().map((f) => ({
				path: f.path,
				extension: f.extension,
				size: f.stat.size,
				mtime: f.stat.mtime,
			})),
		read: async (path) => {
			const file = app.vault.getFileByPath(path);
			if (!file) throw new Error(`${path} no longer exists`);
			return new Uint8Array(await app.vault.readBinary(file));
		},
	};
}

let pdfjs: Promise<PdfJsLike> | null = null;

export const obsidianRenderEnv: RenderEnv = {
	loadPdfJs: () => (pdfjs ??= loadPdfJs() as Promise<PdfJsLike>),
	createCanvas: domCanvasFactory,
	decodeImage: domDecodeImage,
};

/** Reads and writes the index state as JSON next to data.json. */
export class StateStore {
	private cached: IndexState | null = null;

	constructor(private readonly plugin: TopKVisualSearchPlugin) {}

	private get path(): string {
		return normalizePath(`${this.plugin.manifest.dir ?? ''}/index-state.json`);
	}

	async load(): Promise<IndexState> {
		const collection = this.plugin.settings.collection;
		if (this.cached?.collection === collection) return this.cached;
		let raw: unknown = null;
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.path)) {
			try {
				raw = JSON.parse(await adapter.read(this.path));
			} catch {
				raw = null; // unreadable state means a fresh index, not a crash
			}
		}
		const s = this.plugin.settings;
		const backup = s.vaultId
			? { vaultId: s.vaultId, ...(s.vaultKey ? { vaultKey: s.vaultKey } : {}) }
			: null;
		const state = loadState(raw ?? this.cached, backup, () => crypto.randomUUID(), collection);
		if (bindToVault(state, this.vaultKey(), () => crypto.randomUUID())) {
			this.plugin.log.debug(
				'index state came from another vault folder; starting a new vault id',
			);
		}
		this.cached = state;
		if (s.vaultId !== state.vaultId || s.vaultKey !== (state.vaultKey ?? '')) {
			s.vaultId = state.vaultId;
			s.vaultKey = state.vaultKey ?? '';
			await this.plugin.saveSettings();
		}
		return state;
	}

	/** Obsidian's id for this vault folder (internal, but stable per vault); the folder path as a fallback. */
	private vaultKey(): string {
		const app = this.plugin.app as unknown as { appId?: string };
		if (app.appId) return app.appId;
		const adapter = this.plugin.app.vault.adapter;
		return adapter instanceof FileSystemAdapter
			? adapter.getBasePath()
			: this.plugin.app.vault.getName();
	}

	async save(state: IndexState): Promise<void> {
		this.cached = state;
		await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(state));
	}

	/** Moves known files from oldPath (a file or a folder) to newPath. Content hashes don't change. */
	async rename(oldPath: string, newPath: string): Promise<void> {
		const state = await this.load();
		if (renamePaths(state, oldPath, newPath)) await this.save(state);
	}
}

export function indexOptions(plugin: TopKVisualSearchPlugin): IndexOptions {
	const s = plugin.settings;
	return {
		...DEFAULT_INDEX_OPTIONS,
		includeFolders: s.includeFolders,
		excludeGlobs: s.excludeGlobs,
		maxPagesPerFile: s.maxPagesPerFile,
		maxPixels: s.maxPixels,
		concurrency: s.concurrency,
	};
}

/** Runs "Index vault": plan, confirm on first run, upload with status bar progress and cancel. */
export class IndexController {
	private controller: AbortController | null = null;
	private readonly statusEl: HTMLElement;
	private readonly textEl: HTMLElement;

	constructor(private readonly plugin: TopKVisualSearchPlugin) {
		this.statusEl = plugin.addStatusBarItem();
		this.statusEl.addClass('topk-status');
		this.textEl = this.statusEl.createSpan();
		const cancel = this.statusEl.createEl('a', {
			text: 'Cancel',
			cls: 'topk-status-cancel',
			href: '#',
		});
		cancel.addEventListener('click', (e) => {
			e.preventDefault();
			this.cancel();
		});
		this.statusEl.hide();
	}

	get running(): boolean {
		return this.controller !== null;
	}

	cancel(): void {
		this.controller?.abort();
	}

	private paused = 0;

	/**
	 * Stops any run, waits until it has wound down (it shares the index state), and keeps new runs
	 * from starting while `task` changes that state. Used by the maintenance commands.
	 */
	async whilePaused<T>(task: () => Promise<T>): Promise<T> {
		this.paused++;
		try {
			this.cancel();
			await this.current?.catch(() => undefined);
			return await task();
		} finally {
			this.paused--;
		}
	}

	/**
	 * Runs Index vault. A background run (triggered by vault changes or startup, ADR-005) is
	 * silent: it skips when auto-indexing is off, consent or the key is missing, shows the status
	 * bar only once uploads start, and notifies only about failures. It waits for a run in progress.
	 */
	async run(options: { background?: boolean; retryFailed?: boolean } = {}): Promise<void> {
		const background = options.background ?? false;
		if (this.paused > 0) {
			if (!background) new Notice('Wait a moment: the index is being changed.');
			return;
		}
		if (this.current) {
			if (!background) {
				new Notice('Indexing is already running.');
				return;
			}
			await this.current;
			if (this.paused > 0) return;
		}
		if (background) {
			const s = this.plugin.settings;
			if (!s.autoIndex || !s.uploadConsent || !this.plugin.apiKey()) return;
		}
		this.current = this.runOnce(background, options.retryFailed ?? false).finally(
			() => (this.current = null),
		);
		await this.current;
	}

	private current: Promise<void> | null = null;

	private async runOnce(background: boolean, retryFailed: boolean): Promise<void> {
		// A collection from before page text (ADR-006) is replaced first; see upgradeCollection().
		const client = await this.plugin.upgradeCollection().catch((err: unknown) => {
			this.plugin.log.debug('collection upgrade check failed', String(err));
			return this.plugin.createClient();
		});
		if (!client) return;
		const controller = new AbortController();
		this.controller = controller;
		if (!background) {
			this.statusEl.show();
			this.textEl.setText('Scanning…');
		}
		const store = this.plugin.stateStore;
		try {
			const state = await store.load();
			const deps = {
				reader: vaultReader(this.plugin.app),
				client,
				env: obsidianRenderEnv,
				state,
				save: (s: IndexState) => store.save(s),
				signal: controller.signal,
				onProgress: (p: Parameters<typeof progressText>[0]) => {
					if (background && p.phase === 'scanning') return;
					this.statusEl.show();
					this.textEl.setText(progressText(p));
				},
			};
			// Pages left in a collection this vault no longer uses are deleted first.
			// A failure here (offline, say) must not block indexing; the next run tries again.
			await this.plugin
				.purgeStaleCollections(state)
				.catch((err: unknown) =>
					this.plugin.log.debug('old collection cleanup failed', String(err)),
				);
			const options = { ...indexOptions(this.plugin), retryFailed };
			const plan = await planIndex(deps, options);
			this.plugin.log.debug('index plan', {
				work: plan.work.length,
				pages: plan.totalPages,
				unchanged: plan.unchanged,
			});
			if (plan.work.length > 0 && !this.plugin.settings.uploadConsent) {
				if (background) return;
				this.statusEl.hide();
				if (
					!(await confirmFirstUpload(
						this.plugin.app,
						plan,
						this.plugin.settings.collection,
					))
				) {
					new Notice('Nothing was uploaded.');
					return;
				}
				this.plugin.settings.uploadConsent = true;
				await this.plugin.saveSettings();
				this.statusEl.show();
			}
			// Outages pause the run instead of failing it; each retry re-plans, skipping finished files.
			const summary = await runUntilDone(
				(attempt) =>
					attempt === 0 ? runIndex(deps, options, plan) : runIndex(deps, options),
				{
					signal: controller.signal,
					waitForRetry: (signal) => waitForConnection(signal),
					onPause: (err) => {
						this.plugin.log.debug('index paused', err.kind, err.message);
						this.textEl.setText(
							err.kind === 'rate_limit'
								? 'TopK is busy, resuming shortly…'
								: 'Offline, will resume when connected…',
						);
					},
					onResume: () => this.textEl.setText('Resuming…'),
				},
			);
			if (!background || summary.failed.length > 0) new Notice(summaryText(summary), 8_000);
			for (const f of summary.failed) this.plugin.log.debug('index failed', f.path, f.reason);
		} catch (err) {
			new Notice(
				err instanceof TopKError ? err.message : `Indexing failed: ${String(err)}`,
				10_000,
			);
		} finally {
			client.close();
			this.controller = null;
			this.statusEl.hide();
		}
	}
}

/** Destructive maintenance commands. Each asks first and refuses to run during indexing. */
export class IndexMaintenance {
	constructor(
		private readonly plugin: TopKVisualSearchPlugin,
		private readonly indexer: IndexController,
	) {}

	// Each command asks first, then stops any run and keeps runs paused while it changes the
	// index, because a run in progress shares and writes the same state (beta 1 F9, F10).

	async rebuild(): Promise<void> {
		const pages = indexStatus(await this.plugin.stateStore.load()).pages;
		const ok = await confirm(
			this.plugin.app,
			'Rebuild index?',
			`This deletes this vault\u2019s pages from TopK and uploads every page again with the current settings. ${costSentence(pages)}`,
			'Rebuild',
		);
		if (!ok) return;
		await this.indexer.whilePaused(async () => {
			const state = await this.plugin.stateStore.load();
			resetUploads(state);
			await this.plugin.stateStore.save(state);
		});
		this.plugin.lastSearch = null;
		await this.indexer.run();
	}

	async removeData(): Promise<void> {
		const ok = await confirm(
			this.plugin.app,
			'Remove your data from TopK?',
			'This deletes every page image and embedding this vault uploaded to TopK and stops automatic uploads until you run Index vault again. Other vaults in the same collection are not affected. Your files are not touched.',
			'Remove',
		);
		if (!ok) return;
		await this.indexer.whilePaused(async () => {
			const client = this.plugin.createClient();
			if (!client) return;
			try {
				const state = await this.plugin.stateStore.load();
				await this.plugin.purgeStaleCollections(state);
				await client.deleteVault(state.vaultId);
				state.hashes = {};
				delete state.lastLsn;
				delete state.needsPurge;
				await this.plugin.stateStore.save(state);
				// Without consent, background runs do nothing; Index vault asks again first.
				this.plugin.settings.uploadConsent = false;
				await this.plugin.saveSettings();
				this.plugin.lastSearch = null;
				new Notice(
					'Removed this vault\u2019s pages from TopK. Nothing is uploaded until you index the vault again.',
				);
			} catch (err) {
				new Notice(
					err instanceof TopKError
						? err.message
						: `Could not remove data: ${String(err)}`,
					10_000,
				);
			} finally {
				client.close();
			}
		});
	}

	async clearLocal(): Promise<void> {
		const ok = await confirm(
			this.plugin.app,
			'Clear local index?',
			'This forgets what has been indexed on this device. The next index removes this vault\u2019s pages from TopK and uploads them again.',
			'Clear',
		);
		if (!ok) return;
		await this.indexer.whilePaused(async () => {
			const state = await this.plugin.stateStore.load();
			state.files = {};
			resetUploads(state);
			await this.plugin.stateStore.save(state);
		});
		this.plugin.lastSearch = null;
		new Notice('Local index cleared.');
	}
}

function confirm(app: App, title: string, body: string, cta: string): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, title, body, cta, resolve).open());
}

class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly body: string,
		private readonly cta: string,
		private readonly answer: (ok: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl('p', { text: this.body });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
			.addButton((b) =>
				b
					.setButtonText(this.cta)
					.setWarning()
					.onClick(() => this.finish(true)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.answer(false);
	}

	private finish(ok: boolean): void {
		this.answered = true;
		this.answer(ok);
		this.close();
	}
}

function confirmFirstUpload(app: App, plan: IndexPlan, collection: string): Promise<boolean> {
	return new Promise((resolve) => {
		new FirstRunModal(app, plan, collection, resolve).open();
	});
}

class FirstRunModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly plan: IndexPlan,
		private readonly collection: string,
		private readonly answer: (start: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, plan } = this;
		this.setTitle('Upload pages to TopK?');
		const files = plan.work.length.toLocaleString('en-US');
		const pages = plan.totalPages.toLocaleString('en-US');
		contentEl.createEl('p', {
			text: `${files} files with ${pages} pages will be uploaded to your TopK collection "${this.collection}".`,
		});
		const list = contentEl.createEl('ul');
		list.createEl('li', {
			text: 'Each page is sent as an image, with the text of PDF pages, and stored in TopK so it can be searched.',
		});
		list.createEl('li', { text: 'File names and folder paths stay on this device.' });
		list.createEl('li', { text: costSentence(plan.totalPages) });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
			.addButton((b) =>
				b
					.setButtonText('Start indexing')
					.setCta()
					.onClick(() => this.finish(true)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.answer(false);
	}

	private finish(start: boolean): void {
		this.answered = true;
		this.answer(start);
		this.close();
	}
}

/** Resolves when the browser reports the connection is back, or after 30 s, whichever is first. */
function waitForConnection(signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const done = (): void => {
			window.clearTimeout(timer);
			window.removeEventListener('online', done);
			signal?.removeEventListener('abort', done);
			resolve();
		};
		const timer = window.setTimeout(done, 30_000);
		window.addEventListener('online', done);
		signal?.addEventListener('abort', done);
	});
}

/** "Show index status": what is indexed, skipped and failed, with Retry for failures. */
export class IndexStatusModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TopKVisualSearchPlugin,
	) {
		super(app);
	}

	override async onOpen(): Promise<void> {
		this.setTitle('Visual search index');
		const { contentEl } = this;
		const status = indexStatus(await this.plugin.stateStore.load());
		const n = (v: number): string => v.toLocaleString('en-US');
		const summary = contentEl.createEl('p');
		summary.setText(
			`${n(status.files)} files and ${n(status.pages)} pages indexed in "${this.plugin.settings.collection}".`,
		);
		if (status.lastIndexed) {
			contentEl.createEl('p', {
				cls: 'setting-item-description',
				text: `Last updated ${new Date(status.lastIndexed).toLocaleString()}.`,
			});
		}
		if (status.partial > 0) {
			contentEl.createEl('p', {
				text: `${n(status.partial)} files are partly uploaded and finish on the next run.`,
			});
		}
		this.list('Failed', status.failed);
		this.list('Skipped', status.skipped);
		const buttons = new Setting(contentEl);
		if (status.failed.length > 0) {
			buttons.addButton((b) =>
				b
					.setButtonText('Retry failed')
					.setCta()
					.onClick(() => {
						this.close();
						void this.plugin.indexer.run({ retryFailed: true });
					}),
			);
		}
		buttons.addButton((b) => b.setButtonText('Close').onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private list(title: string, items: { path: string; reason: string }[]): void {
		if (items.length === 0) return;
		new Setting(this.contentEl).setName(`${title} (${items.length})`).setHeading();
		const ul = this.contentEl.createEl('ul', { cls: 'topk-status-list' });
		for (const item of items) {
			const li = ul.createEl('li');
			li.createEl('strong', { text: item.path });
			li.appendText(` \u2014 ${item.reason}`);
		}
	}
}
