import { Notice, Plugin } from 'obsidian';
import { IndexController, StateStore } from './indexing';
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

	override async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData(), this.app.vault.configDir);
		this.log.enabled = this.settings.debugLog;
		this.addSettingTab(new TopKSettingTab(this.app, this));
		this.indexer = new IndexController(this);

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
