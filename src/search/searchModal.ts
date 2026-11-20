import { Modal, setIcon, type App } from 'obsidian';
import type TopKVisualSearchPlugin from '../main';
import { obsidianRenderEnv } from '../indexing';
import { pdfPagePreview } from '../render/preview';
import { TopKError } from '../topk/client';
import { domCanvasFactory } from '../util/domCanvas';
import { fileName, type ResolvedResult } from './links';
import { shortQueryWords } from './nameMatch';
import { searchNotes, type NoteResult } from './searchNotes';
import { searchVault } from './searchVault';
import { cleanQuery, MAX_QUERY_CHARS } from './results';

const FETCH_K = 20;
const SHOW_K = 10;
/** Notes shown above the pages when notes search is on (ADR-007). */
const SHOW_NOTES = 5;

export interface LastSearch {
	query: string;
	results: ResolvedResult[];
	notes?: NoteResult[];
}

/** "Visual search": type a description, get the top pages with thumbnails, open one. */
export class VisualSearchModal extends Modal {
	private inputEl!: HTMLInputElement;
	private statusEl!: HTMLElement;
	private notesEl!: HTMLElement;
	private listEl!: HTMLElement;
	private rows: HTMLElement[] = [];
	private readonly objectUrls: string[] = [];
	private readonly fileCache = new Map<string, Promise<Uint8Array>>();
	private searchId = 0;

	constructor(
		app: App,
		private readonly plugin: TopKVisualSearchPlugin,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('topk-search-modal');
		this.setTitle('Visual search');
		const { contentEl } = this;
		this.inputEl = contentEl.createEl('input', {
			type: 'search',
			cls: 'topk-search-input',
			attr: {
				placeholder: 'Describe the page you are looking for',
				maxlength: String(MAX_QUERY_CHARS),
			},
		});
		this.statusEl = contentEl.createDiv({ cls: 'topk-search-status' });
		this.notesEl = contentEl.createDiv({ cls: 'topk-notes' });
		this.listEl = contentEl.createDiv({ cls: 'topk-results' });
		const footer = contentEl.createDiv({ cls: 'topk-search-footer' });
		const save = footer.createEl('button', { text: 'Save results as note' });
		save.addEventListener('click', () => void this.plugin.saveResultsNote());

		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.search(this.inputEl.value);
			} else if (e.key === 'ArrowDown' && this.rows.length > 0) {
				e.preventDefault();
				this.rows[0]?.focus();
			}
		});
		const last = this.plugin.lastSearch;
		if (last) {
			this.inputEl.value = last.query;
			this.showResults(last.results, last.notes ?? []);
		}
		this.inputEl.focus();
		this.inputEl.select();
	}

	override onClose(): void {
		this.searchId++;
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.contentEl.empty();
	}

	async search(text: string): Promise<void> {
		const query = cleanQuery(text);
		if (!query) return;
		const id = ++this.searchId;
		const state = await this.plugin.stateStore.load();
		const notesState = this.plugin.settings.indexNotes
			? await this.plugin.notesStore.load()
			: null;
		const hasPages = Object.values(state.hashes).some(
			(h) => h.status === 'indexed' || h.status === 'partial',
		);
		const hasNotes = Object.values(notesState?.notes ?? {}).some((n) => n.ids.length > 0);
		if (!hasPages && !hasNotes) {
			this.statusEl.setText('Nothing is indexed yet. Run the index vault command first.');
			return;
		}
		const client = this.plugin.createClient();
		if (!client) return;
		const notesClient = notesState && hasNotes ? this.plugin.createNotesClient() : null;
		this.statusEl.setText('Searching…');
		this.notesEl.empty();
		this.listEl.empty();
		this.rows = [];
		const started = performance.now();
		try {
			const exists = (path: string): boolean => this.app.vault.getFileByPath(path) !== null;
			const [pages, notes] = await Promise.all([
				searchVault(client, query, state, {
					k: SHOW_K,
					fetchK: FETCH_K,
					exists,
					...(state.lastLsn ? { requiredLsn: state.lastLsn } : {}),
					onExactError: (err) =>
						this.plugin.log.debug('exact search failed', String(err)),
				}),
				notesClient && notesState
					? searchNotes(notesClient, query, notesState, {
							k: SHOW_NOTES,
							fetchK: FETCH_K,
							exists,
						}).catch((err: unknown): NoteResult[] => {
							// Notes are extra: a failure there must not hide the page results.
							this.plugin.log.debug('notes search failed', String(err));
							return [];
						})
					: Promise.resolve<NoteResult[]>([]),
			]);
			const { results, exact, exactMatches } = pages;
			if (id !== this.searchId) return;
			this.plugin.lastSearch = { query, results, notes };
			this.plugin.log.debug('search', {
				ms: Math.round(performance.now() - started),
				results: results.length,
				notes: notes.length,
				exactMatches,
			});
			this.showResults(results, notes);
			if (exact && exactMatches === 0) {
				this.statusEl.setText(
					`No page contains ${exact.terms.map((t) => `"${t}"`).join(', ')}. Showing the closest pages.`,
				);
			} else if (shortQueryWords(query).length === 1 && !exact) {
				this.statusEl.setText(
					'Tip: one word is hard to search by how a page looks. Describe it in a few words, like "old world map".',
				);
			}
		} catch (err) {
			if (id !== this.searchId) return;
			this.statusEl.setText(
				err instanceof TopKError ? err.message : `Search failed: ${String(err)}`,
			);
		} finally {
			client.close();
			notesClient?.close();
		}
	}

	private showResults(results: ResolvedResult[], notes: NoteResult[]): void {
		this.notesEl.empty();
		this.listEl.empty();
		this.rows = [];
		this.statusEl.setText(
			results.length === 0 && notes.length === 0 ? 'No matching pages.' : '',
		);
		if (notes.length > 0) {
			this.notesEl.createDiv({ cls: 'topk-section-title', text: 'Notes' });
			for (const note of notes) this.rows.push(this.renderNoteRow(note, this.rows.length));
			if (results.length > 0) {
				this.notesEl.createDiv({ cls: 'topk-section-title', text: 'Pages' });
			}
		}
		for (const result of results) this.rows.push(this.renderRow(result, this.rows.length));
	}

	private renderNoteRow(note: NoteResult, index: number): HTMLElement {
		const row = this.notesEl.createDiv({
			cls: 'topk-result topk-note',
			attr: { tabindex: '0', 'data-rank': String(index + 1) },
		});
		const body = row.createDiv({ cls: 'topk-result-body' });
		const title = body.createDiv({ cls: 'topk-result-title' });
		setIcon(title.createSpan({ cls: 'topk-result-icon' }), 'sticky-note');
		title.createSpan({ text: fileName(note.path).replace(/\.md$/i, '') });
		const where = note.heading ? `§ ${note.heading} · ${note.path}` : note.path;
		body.createDiv({
			cls: 'topk-result-meta',
			text: note.exactMatch ? `${where} · exact match` : where,
		});
		const open = (): void => {
			this.close();
			void this.plugin.openNote(note);
		};
		row.addEventListener('click', open);
		row.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') open();
			else if (e.key === 'ArrowDown') (this.rows[index + 1] ?? row).focus();
			else if (e.key === 'ArrowUp') (this.rows[index - 1] ?? this.inputEl).focus();
			else return;
			e.preventDefault();
		});
		return row;
	}

	private renderRow(result: ResolvedResult, index: number): HTMLElement {
		const row = this.listEl.createDiv({
			cls: 'topk-result',
			attr: { tabindex: '0', 'data-rank': String(index + 1) },
		});
		const thumb = row.createDiv({ cls: 'topk-result-thumb' });
		const body = row.createDiv({ cls: 'topk-result-body' });
		const title = body.createDiv({ cls: 'topk-result-title' });
		const icon = title.createSpan({ cls: 'topk-result-icon' });
		setIcon(icon, result.kind === 'pdf_page' ? 'file-text' : 'image');
		title.createSpan({ text: fileName(result.path) });
		const meta =
			result.kind === 'pdf_page' ? `Page ${result.page} · ${result.path}` : result.path;
		body.createDiv({
			cls: 'topk-result-meta',
			text: result.exactMatch
				? `${meta} · exact match`
				: result.nameMatch
					? `${meta} · matched by file name`
					: meta,
		});
		const snippet = body.createDiv({ cls: 'topk-result-snippet' });

		const open = (): void => {
			this.close();
			void this.plugin.openResult(result);
		};
		row.addEventListener('click', open);
		row.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') open();
			else if (e.key === 'ArrowDown') (this.rows[index + 1] ?? row).focus();
			else if (e.key === 'ArrowUp') (this.rows[index - 1] ?? this.inputEl).focus();
			else return;
			e.preventDefault();
		});
		void this.fillPreview(result, thumb, snippet);
		return row;
	}

	private async fillPreview(
		result: ResolvedResult,
		thumb: HTMLElement,
		snippet: HTMLElement,
	): Promise<void> {
		const file = this.app.vault.getFileByPath(result.path);
		if (!file) return;
		if (result.kind !== 'pdf_page') {
			thumb.createEl('img', { attr: { src: this.app.vault.getResourcePath(file), alt: '' } });
			return;
		}
		try {
			let data = this.fileCache.get(result.path);
			if (!data) {
				data = this.app.vault.readBinary(file).then((b) => new Uint8Array(b));
				this.fileCache.set(result.path, data);
			}
			const preview = await pdfPagePreview(
				await obsidianRenderEnv.loadPdfJs(),
				await data,
				result.page,
				domCanvasFactory,
				{ thumbnailLongSide: 240, snippetLength: 140 },
			);
			snippet.setText(preview.snippet);
			if (preview.thumbnail) {
				const url = URL.createObjectURL(
					new Blob([preview.thumbnail as Uint8Array<ArrayBuffer>], {
						type: 'image/jpeg',
					}),
				);
				this.objectUrls.push(url);
				thumb.createEl('img', { attr: { src: url, alt: '' } });
			}
		} catch (err) {
			this.plugin.log.debug('preview failed', result.path, String(err));
		}
	}
}
