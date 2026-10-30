import { Notice, Plugin } from 'obsidian';
import { IndexController, IndexMaintenance, StateStore } from './indexing';
import { noteBaseName, pageLinkText, resultsNote, type ResolvedResult } from './search/links';
import { VisualSearchModal, type LastSearch } from './search/searchModal';
import { TopKSettingTab } from './settings';
import { loadSettings, type Settings } from './settingsModel';
import type { TopKClient } from './topk/client';
import { GrpcTopKClient } from './topk/grpcClient';
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
	}

	openSearch(): void {
		if (!this.apiKey()) {
			this.notifyMissingKey();
			return;
		}
		new VisualSearchModal(this.app, this).open();
	}

	/** Opens a PDF at the result's page, or the image file. */
	async openResult(result: ResolvedResult): Promise<void> {
		await this.app.workspace.openLinkText(
			pageLinkText(result.path, result.page, result.kind),
			'',
			false,
		);
	}

	/** Writes the last search's results as a note of links and opens it. */
	async saveResultsNote(): Promise<void> {
		const last = this.lastSearch;
		if (!last || last.results.length === 0) {
			new Notice('Run a visual search with results first.');
			return;
		}
		const base = noteBaseName(last.query);
		let path = `${base}.md`;
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `${base} ${i}.md`;
		const file = await this.app.vault.create(
			path,
			resultsNote(last.query, last.results, new Date()),
		);
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	override onunload(): void {
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

	/** A client for the current settings, or null after telling the user the key is missing. */
	createClient(): TopKClient | null {
		const apiKey = this.apiKey();
		if (!apiKey) {
			this.notifyMissingKey();
			return null;
		}
		return new GrpcTopKClient({
			apiKey,
			collection: this.settings.collection,
			region: this.settings.region,
			...(this.settings.endpoint ? { endpoint: this.settings.endpoint } : {}),
		});
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
