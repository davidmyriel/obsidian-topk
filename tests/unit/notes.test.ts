import { describe, expect, it } from 'vitest';
import { chunkNote, MAX_CHUNK_CHARS, MAX_CHUNKS } from '../../src/notes/chunk';
import {
	emptyNotesState,
	parseNotesState,
	runNoteIndex,
	type NoteFile,
	type NotesReader,
	type NotesState,
} from '../../src/notes/indexer';
import { searchNotes } from '../../src/search/searchNotes';
import { loadSettings } from '../../src/settingsModel';
import { FakeNotesClient, noteSearchRequest, notesCollection } from '../../src/topk/notes';

const para = (word: string, n: number): string => `${word} `.repeat(n).trim();

describe('chunkNote', () => {
	it('drops frontmatter and splits at headings, keeping each heading', () => {
		const md = `---\ntags: [x]\n---\n# Pricing\n${para('price', 60)}\n\n## Margins\n${para('margin', 60)}`;
		const chunks = chunkNote(md);
		expect(chunks.map((c) => c.heading)).toEqual(['Pricing', 'Margins']);
		expect(chunks[0]?.text.startsWith('# Pricing')).toBe(true);
		expect(chunks.some((c) => c.text.includes('tags:'))).toBe(false);
	});

	it('joins short sections, splits long ones and ignores # inside code fences', () => {
		const md = `# A\nshort\n# B\nalso short\n# C\n${para('word', 900)}\n\n\`\`\`\n# not a heading\n\`\`\``;
		const chunks = chunkNote(md);
		expect(chunks[0]?.heading).toBe('A'); // A and B joined, named after A
		expect(chunks.every((c) => c.text.length <= MAX_CHUNK_CHARS)).toBe(true);
		expect(chunks.some((c) => c.heading === 'not a heading')).toBe(false);
		expect(chunkNote('')).toEqual([]);
		expect(chunkNote('---\na: 1\n---\n')).toEqual([]);
	});

	it(`caps a note at ${MAX_CHUNKS} chunks`, () => {
		const md = Array.from({ length: 300 }, (_, i) => `# H${i}\n${para('x', 120)}`).join('\n');
		expect(chunkNote(md)).toHaveLength(MAX_CHUNKS);
	});
});

class MemoryNotes implements NotesReader {
	files = new Map<string, { text: string; mtime: number }>();
	reads = 0;
	set(path: string, text: string, mtime = 1): void {
		this.files.set(path, { text, mtime });
	}
	list(): NoteFile[] {
		return [...this.files].map(([path, f]) => ({ path, size: f.text.length, mtime: f.mtime }));
	}
	read(path: string): Promise<string> {
		this.reads++;
		const f = this.files.get(path);
		return f ? Promise.resolve(f.text) : Promise.reject(new Error(`${path} no longer exists`));
	}
}

const filter = { includeFolders: [], excludeGlobs: ['.obsidian/**'] };
const pricing = `# Pricing\n${para('pricing strategy for enterprise plans', 12)}\n\n## INV-2291 terms\n${para('invoice terms and payment schedule', 12)}`;

async function index(reader: MemoryNotes, client: FakeNotesClient, state: NotesState) {
	return runNoteIndex({ reader, client, state, save: () => Promise.resolve() }, filter);
}

describe('runNoteIndex', () => {
	it('uploads notes once, follows renames for free and replaces edited notes', async () => {
		const reader = new MemoryNotes();
		reader.set('Work/pricing.md', pricing);
		reader.set('Work/empty.md', '');
		reader.set('.obsidian/plugins/x.md', 'ignored');
		reader.set('cover.png', 'not a note');
		const client = new FakeNotesClient();
		const state = emptyNotesState('v', 'c-notes');
		const first = await index(reader, client, state);
		expect(first.notesIndexed).toBe(2); // the empty note is recorded with no chunks
		expect(client.docs.size).toBe(2);
		expect([...client.docs.values()].every((d) => !d.text.includes('Work/'))).toBe(true);

		// Unchanged: nothing read, nothing uploaded.
		reader.reads = 0;
		const again = await index(reader, client, state);
		expect([again.notesIndexed, reader.reads]).toEqual([0, 0]);

		// Rename: same content, so no upload.
		const entry = reader.files.get('Work/pricing.md');
		reader.files.delete('Work/pricing.md');
		if (entry) reader.files.set('Archive/pricing.md', entry);
		expect((await index(reader, client, state)).notesIndexed).toBe(0);

		// Edit: old chunks deleted, new ones uploaded.
		reader.set('Archive/pricing.md', `${pricing}\n\nMore text.`, 2);
		const edited = await index(reader, client, state);
		expect(edited.chunksDeleted).toBe(2);
		expect(edited.notesIndexed).toBe(1);
		expect(client.docs.size).toBe(2);

		// Delete: chunks gone.
		reader.files.delete('Archive/pricing.md');
		await index(reader, client, state);
		expect(client.docs.size).toBe(0);
	});

	it('purges a changed collection or vault and remembers the old collection', () => {
		const state = emptyNotesState('v', 'old-notes');
		state.notes.h = { headings: [''], ids: ['v:h:0'], status: 'indexed', updatedAt: 0 };
		const moved = parseNotesState(JSON.parse(JSON.stringify(state)), 'v', 'new-notes');
		expect(moved).toMatchObject({
			notes: {},
			needsPurge: true,
			staleCollections: ['old-notes'],
		});
		const same = parseNotesState(JSON.parse(JSON.stringify(state)), 'v', 'old-notes');
		expect(Object.keys(same.notes)).toEqual(['h']);
		expect(parseNotesState(null, 'v', 'c')).toEqual(emptyNotesState('v', 'c'));
	});
});

describe('searchNotes', () => {
	it('returns one result per note at its best section, exact matches first', async () => {
		const reader = new MemoryNotes();
		reader.set('pricing.md', pricing);
		reader.set('other.md', `# Strategy\n${para('pricing strategy notes for small teams', 12)}`);
		const client = new FakeNotesClient();
		const state = emptyNotesState('v', 'c-notes');
		await index(reader, client, state);

		const plain = await searchNotes(client, 'pricing strategy', state, { k: 5, fetchK: 20 });
		expect(plain.map((r) => r.path).sort()).toEqual(['other.md', 'pricing.md']);

		const exact = await searchNotes(client, 'INV-2291 payment', state, { k: 5, fetchK: 20 });
		expect(exact[0]).toMatchObject({
			path: 'pricing.md',
			heading: 'INV-2291 terms',
			exactMatch: true,
		});
	});

	it('returns nothing when no notes are indexed', async () => {
		const client = new FakeNotesClient();
		expect(
			await searchNotes(client, 'x', emptyNotesState('v', 'c'), { k: 5, fetchK: 20 }),
		).toEqual([]);
	});
});

describe('notes settings and requests', () => {
	it('notes search is off unless turned on', () => {
		expect(loadSettings({}, '.obsidian').indexNotes).toBe(false);
		expect(loadSettings({ indexNotes: true }, '.obsidian').indexNotes).toBe(true);
		expect(notesCollection('obsidian-visual-search-v2')).toBe(
			'obsidian-visual-search-v2-notes',
		);
	});

	it('builds a semantic query, and a hybrid one for exact terms', () => {
		expect(noteSearchRequest('pricing', 'v', 10).query?.stages).toHaveLength(4);
		const hybrid = noteSearchRequest('INV-2291', 'v', 10, ['INV-2291']).query?.stages ?? [];
		expect(hybrid).toHaveLength(5);
		expect(hybrid[2]?.stage.case === 'filter' && hybrid[2].stage.value.expr?.expr.case).toBe(
			'textExpr',
		);
	});
});
