import { normalizePath, type App } from 'obsidian';
import type TopKVisualSearchPlugin from './main';
import {
	emptyNotesState,
	parseNotesState,
	runNoteIndex,
	type NotesReader,
	type NotesState,
	type NotesSummary,
} from './notes/indexer';
import { renamePaths } from './indexer/state';
import { notesCollection } from './topk/notes';

// Obsidian side of notes search (ADR-007): the notes state file, the reader, and one notes run.

export function notesReader(app: App): NotesReader {
	return {
		list: () =>
			app.vault.getMarkdownFiles().map((f) => ({
				path: f.path,
				size: f.stat.size,
				mtime: f.stat.mtime,
			})),
		read: async (path) => {
			const file = app.vault.getFileByPath(path);
			if (!file) throw new Error(`${path} no longer exists`);
			return app.vault.cachedRead(file);
		},
	};
}

/** Reads and writes notes-state.json next to index-state.json. */
export class NotesStore {
	private cached: NotesState | null = null;

	constructor(private readonly plugin: TopKVisualSearchPlugin) {}

	private get path(): string {
		return normalizePath(`${this.plugin.manifest.dir ?? ''}/notes-state.json`);
	}

	/** The notes collection that goes with the current page collection. */
	get collection(): string {
		return notesCollection(this.plugin.settings.collection);
	}

	async load(): Promise<NotesState> {
		const { vaultId } = await this.plugin.stateStore.load();
		const collection = this.collection;
		if (this.cached?.collection === collection && this.cached.vaultId === vaultId) {
			return this.cached;
		}
		let raw: unknown = this.cached;
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.path)) {
			try {
				raw = JSON.parse(await adapter.read(this.path));
			} catch {
				raw = null;
			}
		}
		this.cached = parseNotesState(raw, vaultId, collection);
		return this.cached;
	}

	async save(state: NotesState): Promise<void> {
		this.cached = state;
		await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(state));
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const state = await this.load();
		// renamePaths only touches `files`, which the two state shapes share.
		if (renamePaths(state as never, oldPath, newPath)) await this.save(state);
	}

	/** Forgets every uploaded note; the next run purges this vault's notes and uploads again. */
	async reset(forgetFiles = false): Promise<void> {
		const state = await this.load();
		state.notes = {};
		delete state.lastLsn;
		state.needsPurge = true;
		if (forgetFiles) state.files = {};
		await this.save(state);
	}

	/** After "Remove my data" or turning notes off: nothing uploaded, nothing to purge. */
	async clear(): Promise<void> {
		const state = emptyNotesState(
			(await this.plugin.stateStore.load()).vaultId,
			this.collection,
		);
		await this.save(state);
	}
}

/** Deletes this vault's notes from TopK (current and earlier notes collections) and clears the state. */
export async function removeNotes(plugin: TopKVisualSearchPlugin): Promise<void> {
	const state = await plugin.notesStore.load();
	for (const name of [state.collection, ...(state.staleCollections ?? [])]) {
		const client = plugin.createNotesClient(name);
		if (!client) throw new Error('missing API key');
		try {
			await client.deleteVault(state.vaultId);
		} finally {
			client.close();
		}
	}
	await plugin.notesStore.clear();
}

/** One notes run after the page run, when notes search is on. */
export async function runNotes(
	plugin: TopKVisualSearchPlugin,
	signal: AbortSignal,
	onProgress: (done: number, total: number) => void,
): Promise<NotesSummary | null> {
	if (!plugin.settings.indexNotes) return null;
	const store = plugin.notesStore;
	const state = await store.load();
	// Notes left in a collection this vault no longer uses are deleted first.
	for (const old of [...(state.staleCollections ?? [])]) {
		const stale = plugin.createNotesClient(old);
		if (!stale) return null;
		try {
			await stale.deleteVault(state.vaultId);
			state.staleCollections = (state.staleCollections ?? []).filter((c) => c !== old);
			if (state.staleCollections.length === 0) delete state.staleCollections;
			await store.save(state);
		} finally {
			stale.close();
		}
	}
	const client = plugin.createNotesClient();
	if (!client) return null;
	try {
		const s = plugin.settings;
		return await runNoteIndex(
			{
				reader: notesReader(plugin.app),
				client,
				state,
				save: (st) => store.save(st),
				signal,
				onProgress,
			},
			{ includeFolders: s.includeFolders, excludeGlobs: s.excludeGlobs },
		);
	} finally {
		client.close();
	}
}

/** "N notes" text for notices. */
export function notesSummaryText(s: NotesSummary): string {
	const parts = [
		s.notesIndexed > 0 ? `${s.notesIndexed} notes indexed` : null,
		s.chunksDeleted > 0 ? `${s.chunksDeleted} note sections removed` : null,
		s.failed.length > 0 ? `${s.failed.length} notes failed` : null,
	].filter(Boolean);
	return parts.length > 0 ? `Notes: ${parts.join(', ')}.` : '';
}
