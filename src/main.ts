import { Notice, Plugin, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { ReindexScheduler } from './indexer/scheduler';
import { purgeStaleCollections, type IndexState } from './indexer/state';
import { sourceKind } from './render/pageSource';
import { IndexController, IndexMaintenance, IndexStatusModal, StateStore } from './indexing';
import { NotesStore } from './notesIndexing';
import { noteBaseName, resultsNote, type ResolvedResult } from './search/links';
import { VisualSearchModal, type LastSearch } from './search/searchModal';
import { TopKSettingTab } from './settings';
import { loadSettings, nextCollectionName, type Settings } from './settingsModel';
import type { TopKClient } from './topk/client';
import { GrpcTopKClient } from './topk/grpcClient';
import { GrpcNotesClient, notesCollection, type NotesClient } from './topk/notes';
import { Logger } from './util/logger';

/** The settings modal is not in the public API; this is the subset used to open our tab. */
interface SettingsOpener {
	open(): void;
	openTabById(id: string): void;
}

export default class TopKVisualSearchPlugin extends Plugin {
	declare settings: Settings;
	readonly log = new Logger();
	readonly stateStore = new StateStore(this);
	readonly notesStore = new NotesStore(this);
	indexer!: IndexController;
	lastSearch: LastSearch | null = null;

	override async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData(), this.app.vault.configDir);
		this.log.enabled = this.settings.debugLog;
		this.addSettingTab(new TopKSettingTab(this.app, this));
		this.indexer = new IndexController(this);
		const maintenance = new IndexMaintenance(this, this.indexer);

		this.addCommand({
			id: 'index-vault',
			name: 'Index vault',
			callback: () => void this.indexer.run(),
		});
		this.addCommand({
			id: 'cancel-indexing',
			name: 'Cancel indexing',
			checkCallback: (checking) => {
				if (!this.indexer.running) return false;
				if (!checking) this.indexer.cancel();
				return true;
			},
		});
		this.addCommand({
			id: 'show-index-status',
			name: 'Show index status',
			callback: () => new IndexStatusModal(this.app, this).open(),
		});
		this.addCommand({
			id: 'rebuild-index',
			name: 'Rebuild index',
			callback: () => void maintenance.rebuild(),
		});
		this.addCommand({
			id: 'remove-data-from-topk',
			name: 'Remove my data from TopK',
			callback: () => void maintenance.removeData(),
		});
		this.addCommand({
			id: 'clear-local-index',
			name: 'Clear local index',
			callback: () => void maintenance.clearLocal(),
		});
		this.addCommand({
			id: 'visual-search',
			name: 'Visual search',
			callback: () => this.openSearch(),
		});
		this.addCommand({
			id: 'save-results-as-note',
			name: 'Save results as note',
			callback: () => void this.saveResultsNote(),
		});
		this.addRibbonIcon('scan-search', 'Visual search', () => this.openSearch());

		// Background indexing (ADR-005). Events are registered after the layout is ready, because
		// Obsidian fires a create event for every file while it loads the vault.
		this.scheduler = new ReindexScheduler(() => this.indexer.run({ background: true }), 5_000, {
			setTimeout: (fn, ms) => window.setTimeout(fn, ms),
			clearTimeout: (h) => window.clearTimeout(h),
		});
		this.app.workspace.onLayoutReady(() => {
			const changed = (file: TAbstractFile): void => {
				if (this.isIndexable(file)) this.scheduler?.request();
			};
			this.registerEvent(this.app.vault.on('create', changed));
			this.registerEvent(this.app.vault.on('modify', changed));
			this.registerEvent(this.app.vault.on('delete', changed));
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					// Results follow a rename right away instead of after the next run (beta 1 F8).
					void this.stateStore.rename(oldPath, file.path);
					void this.notesStore.rename(oldPath, file.path);
					changed(file);
				}),
			);
			// Catch changes made while Obsidian was closed, and finish an interrupted run.
			this.scheduler?.request();
		});
	}

	private scheduler: ReindexScheduler | null = null;

	private isIndexable(file: TAbstractFile): boolean {
		if (file instanceof TFolder) return true; // a folder rename or delete moves its files
		if (!(file instanceof TFile)) return false;
		return (
			sourceKind(file.extension) !== null ||
			(this.settings.indexNotes && file.extension === 'md')
		);
	}

	openSearch(): void {
		if (!this.apiKey()) {
			this.notifyMissingKey();
			return;
		}
		new VisualSearchModal(this.app, this).open();
	}

	/** Opens a PDF at the result's page, or the image file. */
	/**
	 * Opens a PDF at the result's page, or the image file. Opens the file object rather than a
	 * link string: link text breaks on `#` or `|` in names, and an unresolved link would create an
	 * empty note (beta 1 F7, F8).
	 */
	async openResult(result: ResolvedResult): Promise<void> {
		const file = this.app.vault.getFileByPath(result.path);
		if (!file) {
			new Notice(`${result.path} no longer exists.`);
			return;
		}
		const subpath = result.kind === 'pdf_page' ? `#page=${result.page}` : undefined;
		await this.app.workspace
			.getLeaf(false)
			.openFile(file, subpath ? { eState: { subpath } } : {});
	}

	/** Opens a note at the heading of the matching section (ADR-007). */
	async openNote(note: { path: string; heading: string }): Promise<void> {
		const file = this.app.vault.getFileByPath(note.path);
		if (!file) {
			new Notice(`${note.path} no longer exists.`);
			return;
		}
		await this.app.workspace
			.getLeaf(false)
			.openFile(file, note.heading ? { eState: { subpath: `#${note.heading}` } } : {});
	}

	/** Writes the last search's results as a note of links and opens it. */
	async saveResultsNote(): Promise<void> {
		const last = this.lastSearch;
		if (!last || (last.results.length === 0 && (last.notes ?? []).length === 0)) {
			new Notice('Run a visual search with results first.');
			return;
		}
		const base = noteBaseName(last.query);
		let path = `${base}.md`;
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `${base} ${i}.md`;
		const file = await this.app.vault.create(
			path,
			resultsNote(
				last.query,
				last.results,
				new Date(),
				this.app.vault.getName(),
				last.notes ?? [],
			),
		);
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	override onunload(): void {
		this.scheduler?.dispose();
		this.indexer.cancel();
	}

	async saveSettings(): Promise<void> {
		this.log.enabled = this.settings.debugLog;
		await this.saveData(this.settings);
	}

	apiKey(): string | null {
		if (!this.settings.apiKeySecret) return null;
		const key = this.app.secretStorage.getSecret(this.settings.apiKeySecret);
		this.log.addSecret(key);
		return key || null;
	}

	/**
	 * A client for the current settings (or another collection), or null after telling the user
	 * the key is missing.
	 */
	createClient(collection = this.settings.collection): TopKClient | null {
		const apiKey = this.apiKey();
		if (!apiKey) {
			this.notifyMissingKey();
			return null;
		}
		return new GrpcTopKClient({
			apiKey,
			collection,
			region: this.settings.region,
			...(this.settings.endpoint ? { endpoint: this.settings.endpoint } : {}),
		});
	}

	/** Collections checked this session that already have the page text field. */
	private readonly upToDate = new Set<string>();

	/**
	 * Returns a client for the collection to index into. A collection created before 2.0 has no
	 * page text field and its schema can't be changed (ADR-006), so the plugin moves to a new
	 * collection, "<name>-v2". That is an ordinary collection change: the next run uploads every
	 * page there and deletes this vault's pages from the old one (beta 1 F11).
	 */
	async upgradeCollection(): Promise<TopKClient | null> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const client = this.createClient();
			if (!client) return null;
			const name = this.settings.collection;
			if (this.upToDate.has(name)) return client;
			const { needsUpgrade } = await client.ping();
			if (!needsUpgrade) {
				this.upToDate.add(name);
				return client;
			}
			client.close();
			const next = nextCollectionName(name);
			this.log.debug('collection has no page text; moving to', next);
			this.settings.collection = next;
			await this.saveSettings();
			new Notice(
				`TopK Visual Search now also searches page text. Your pages are being uploaded again to the collection "${next}", and this vault's pages are removed from "${name}". Search works again when the upload finishes.`,
				15_000,
			);
		}
		return this.createClient();
	}

	/** A notes client for the current settings (or another notes collection), or null without a key. */
	createNotesClient(collection = notesCollection(this.settings.collection)): NotesClient | null {
		const apiKey = this.apiKey();
		if (!apiKey) {
			this.notifyMissingKey();
			return null;
		}
		return new GrpcNotesClient({
			apiKey,
			collection,
			region: this.settings.region,
			...(this.settings.endpoint ? { endpoint: this.settings.endpoint } : {}),
		});
	}

	/** Deletes this vault's pages from collections it used before the setting changed (F11). */
	async purgeStaleCollections(state: IndexState): Promise<void> {
		if (!state.staleCollections?.length) return;
		await purgeStaleCollections(
			state,
			async (collection, vaultId) => {
				const client = this.createClient(collection);
				if (!client) throw new Error('missing API key');
				try {
					await client.deleteVault(vaultId);
					this.log.debug('removed pages from old collection', collection);
				} finally {
					client.close();
				}
			},
			(s) => this.stateStore.save(s),
		);
	}

	/** Returns a status message; throws TopKError on failure. */
	async testConnection(): Promise<string> {
		const client = this.createClient();
		if (!client) return 'Set a TopK API key first.';
		try {
			const { collectionExists } = await client.ping();
			return collectionExists
				? `Connected. Collection "${this.settings.collection}" is ready.`
				: `Connected. Collection "${this.settings.collection}" will be created on first index.`;
		} finally {
			client.close();
		}
	}

	notifyMissingKey(): void {
		const fragment = createFragment((f) => {
			f.appendText('TopK Visual Search needs a TopK API key. ');
			f.createEl('a', { text: 'Open settings', href: '#' }, (a) =>
				a.addEventListener('click', (e) => {
					e.preventDefault();
					this.openSettings();
				}),
			);
		});
		new Notice(fragment, 10_000);
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting?: SettingsOpener }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}
}
