import { loadPdfJs, Modal, normalizePath, Notice, Setting, type App } from 'obsidian';
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
import { parseState, type IndexState } from './indexer/state';
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
		this.cached = parseState(raw ?? this.cached, () => crypto.randomUUID(), collection);
		return this.cached;
	}

	async save(state: IndexState): Promise<void> {
		this.cached = state;
		await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(state));
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

	async run(): Promise<void> {
		if (this.controller) {
			new Notice('Indexing is already running.');
			return;
		}
		const client = this.plugin.createClient();
		if (!client) return;
		const controller = new AbortController();
		this.controller = controller;
		this.statusEl.show();
		this.textEl.setText('Scanning…');
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
				onProgress: (p: Parameters<typeof progressText>[0]) =>
					this.textEl.setText(progressText(p)),
			};
			const options = indexOptions(this.plugin);
			const plan = await planIndex(deps, options);
			this.plugin.log.debug('index plan', {
				work: plan.work.length,
				pages: plan.totalPages,
				unchanged: plan.unchanged,
			});
			if (plan.work.length > 0 && !this.plugin.settings.uploadConsent) {
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
			const summary = await runIndex(deps, options, plan);
			new Notice(summaryText(summary), 8_000);
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
			text: 'Each page is sent as an image and stored in TopK so it can be searched.',
		});
		list.createEl('li', { text: 'File names and folder paths stay on this device.' });
		list.createEl('li', { text: 'Usage is billed to your TopK account.' });
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
