import { Notice, PluginSettingTab, SecretComponent, Setting, type App } from 'obsidian';
import type TopKVisualSearchPlugin from './main';
import { compileFilter, parseList } from './indexer/globs';
import { confirm } from './indexing';
import { removeNotes as deleteNotes } from './notesIndexing';
import { collectionNameError, endpointError, PIXEL_BUDGETS, REGIONS } from './settingsModel';
import { TopKError } from './topk/client';

export class TopKSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TopKVisualSearchPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = (): Promise<void> => this.plugin.saveSettings();
		containerEl.empty();

		containerEl.createEl('p', {
			text: 'Page images of your PDF and image files are uploaded to TopK and stored in your TopK collection. File names and paths stay on this device.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('TopK API key')
			.setDesc('Stored in Obsidian’s secret storage. Create a key in the TopK console.')
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(s.apiKeySecret)
					.onChange(async (value) => {
						s.apiKeySecret = value ?? '';
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Region')
			.setDesc('Where your TopK project stores data.')
			.addDropdown((d) => {
				for (const r of REGIONS) d.addOption(r.id, r.label);
				d.setValue(s.region).onChange(async (value) => {
					s.region = value;
					await save();
				});
			});

		// Saved when the field loses focus, not on every keystroke, so a half-typed name never
		// becomes the collection (beta 1 F11).
		const collectionDesc =
			'Created on first index. After a change, the next index uploads the vault to the new collection and deletes its pages from the old one.';
		const collection = new Setting(containerEl).setName('Collection').setDesc(collectionDesc);
		collection.addText((t) => {
			const check = (): string | null => {
				const error = collectionNameError(t.getValue().trim());
				collection.descEl.toggleClass('mod-warning', error !== null);
				collection.setDesc(error ?? collectionDesc);
				return error;
			};
			t.setValue(s.collection).onChange(() => void check());
			t.inputEl.addEventListener('change', () => {
				const name = t.getValue().trim();
				if (check() !== null || name === s.collection) return;
				s.collection = name;
				void save();
			});
		});

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Checks the key, the region and the collection.')
			.addButton((b) =>
				b.setButtonText('Test').onClick(async () => {
					b.setDisabled(true);
					try {
						new Notice(await this.plugin.testConnection());
					} catch (err) {
						new Notice(
							err instanceof TopKError
								? err.message
								: `Connection failed: ${String(err)}`,
						);
					} finally {
						b.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl).setName('Indexing').setHeading();

		new Setting(containerEl)
			.setName('Index automatically')
			.setDesc(
				'Update the index a few seconds after files are added, changed, renamed or deleted, and when Obsidian starts.',
			)
			.addToggle((t) =>
				t.setValue(s.autoIndex).onChange(async (value) => {
					s.autoIndex = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Search notes')
			.setDesc(
				'Also upload the text of your Markdown notes to TopK and search them. Off by default: note text is stored in your TopK collection. File names and paths stay on this device.',
			)
			.addToggle((t) =>
				t.setValue(s.indexNotes).onChange(async (value) => {
					if (value === s.indexNotes) return;
					const ok = value ? await this.confirmNotesOn() : await this.confirmNotesOff();
					if (!ok) {
						t.setValue(s.indexNotes);
						return;
					}
					if (!value) {
						try {
							await this.plugin.indexer.whilePaused(() => deleteNotes(this.plugin));
						} catch (err) {
							new Notice(`Could not delete notes from TopK: ${String(err)}`, 10_000);
							t.setValue(true);
							return;
						}
					}
					s.indexNotes = value;
					await save();
					if (value) void this.plugin.indexer.run();
				}),
			);

		new Setting(containerEl)
			.setName('Include folders')
			.setDesc('One folder per line. Leave empty to index the whole vault.')
			.addTextArea((t) =>
				t.setValue(s.includeFolders.join('\n')).onChange(async (value) => {
					s.includeFolders = parseList(value);
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Exclude patterns')
			.setDesc(
				'One glob per line, for example Private/**. Matching files are never uploaded.',
			)
			.addTextArea((t) =>
				t.setValue(s.excludeGlobs.join('\n')).onChange(async (value) => {
					s.excludeGlobs = parseList(value);
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Max pages per file')
			.setDesc('PDF files with more pages are skipped.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(s.maxPagesPerFile)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isInteger(n) && n >= 1) {
						s.maxPagesPerFile = n;
						await save();
					}
				});
			});

		new Setting(containerEl)
			.setName('Page image size')
			.setDesc(
				'Full detail matches what the TopK model can see. Smaller uploads send about half the data.',
			)
			.addDropdown((d) => {
				for (const b of PIXEL_BUDGETS) d.addOption(String(b.value), b.label);
				d.setValue(String(s.maxPixels)).onChange(async (value) => {
					s.maxPixels = Number(value);
					await save();
				});
			});

		new Setting(containerEl).setName('Advanced').setHeading();

		new Setting(containerEl)
			.setName('Parallel uploads')
			.setDesc(
				'Upload requests sent to TopK at the same time. Lower it on a slow connection.',
			)
			.addSlider((sl) =>
				sl
					.setLimits(1, 8, 1)
					.setValue(s.concurrency)
					.setDynamicTooltip()
					.onChange(async (value) => {
						s.concurrency = value;
						await save();
					}),
			);

		const endpoint = new Setting(containerEl)
			.setName('Custom endpoint')
			.setDesc(
				'Overrides the region, for example a private TopK deployment. Leave empty normally.',
			);
		endpoint.addText((t) =>
			t
				.setPlaceholder('https://…')
				.setValue(s.endpoint)
				.onChange(async (value) => {
					const error = endpointError(value.trim());
					endpoint.descEl.toggleClass('mod-warning', error !== null);
					if (error) {
						endpoint.setDesc(error);
						return;
					}
					endpoint.setDesc(
						'Overrides the region, for example a private TopK deployment. Leave empty normally.',
					);
					s.endpoint = value.trim();
					await save();
				}),
		);

		new Setting(containerEl)
			.setName('Debug log')
			.setDesc('Writes details to the developer console. The API key is never logged.')
			.addToggle((t) =>
				t.setValue(s.debugLog).onChange(async (value) => {
					s.debugLog = value;
					await save();
				}),
			);
	}

	/** Asks before uploading notes, with how many and roughly what it costs (ADR-007). */
	private async confirmNotesOn(): Promise<boolean> {
		const s = this.plugin.settings;
		const include = compileFilter({
			includeFolders: s.includeFolders,
			excludeGlobs: s.excludeGlobs,
		});
		const notes = this.app.vault.getMarkdownFiles().filter((f) => include(f.path));
		const bytes = notes.reduce((n, f) => n + f.stat.size, 0);
		// About 4 characters per token; TopK lists text embedding at $0.05 per 1M tokens.
		const cost = (bytes / 4 / 1e6) * 0.05;
		const costText = cost < 0.01 ? 'less than $0.01' : `about $${cost.toFixed(2)}`;
		return confirm(
			this.app,
			'Search your notes?',
			`${notes.length.toLocaleString('en-US')} notes will be uploaded to TopK, split into sections, and stored in the collection "${s.collection}-notes" so they can be searched. Embedding them costs ${costText}. File names and folder paths stay on this device. Turning this off later deletes them from TopK.`,
			'Upload notes',
		);
	}

	private confirmNotesOff(): Promise<boolean> {
		return confirm(
			this.app,
			'Stop searching notes?',
			"This deletes this vault's notes from TopK. Your notes are not touched, and pages stay searchable.",
			'Delete notes from TopK',
		);
	}
}
