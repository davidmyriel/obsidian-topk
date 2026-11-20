// Splits a Markdown note into sections for embedding (ADR-007). No obsidian import.

export const MAX_CHUNK_CHARS = 2_000;
export const MIN_CHUNK_CHARS = 200;
export const MAX_CHUNKS = 200;

export interface NoteChunk {
	/** The heading this section starts at (without #), or '' for text before the first heading. */
	heading: string;
	text: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Drops a leading YAML frontmatter block. */
function stripFrontmatter(md: string): string {
	if (!md.startsWith('---')) return md;
	const end = md.indexOf('\n---', 3);
	if (end < 0) return md;
	const after = md.indexOf('\n', end + 4);
	return after < 0 ? '' : md.slice(after + 1);
}

/** Splits text longer than the limit at blank lines, then at line breaks, then hard. */
function splitLong(text: string): string[] {
	if (text.length <= MAX_CHUNK_CHARS) return [text];
	const out: string[] = [];
	let current = '';
	for (const para of text.split(/\n\s*\n/)) {
		const pieces =
			para.length > MAX_CHUNK_CHARS
				? (para.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK_CHARS}}`, 'g')) ?? [])
				: [para];
		for (const piece of pieces) {
			if (current && current.length + piece.length + 2 > MAX_CHUNK_CHARS) {
				out.push(current);
				current = '';
			}
			current = current ? `${current}\n\n${piece}` : piece;
		}
	}
	if (current) out.push(current);
	return out;
}

/**
 * Sections of a note: frontmatter dropped, split at headings (outside code fences), long sections
 * split at paragraphs, short ones joined with the next, at most MAX_CHUNKS. Empty notes give [].
 */
export function chunkNote(markdown: string): NoteChunk[] {
	const lines = stripFrontmatter(markdown.replace(/\r\n?/g, '\n')).split('\n');
	const sections: NoteChunk[] = [];
	let heading = '';
	let body: string[] = [];
	let fence = false;
	const flush = (): void => {
		const text = body.join('\n').trim();
		if (text) sections.push({ heading, text });
	};
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		const m = fence ? null : HEADING.exec(line);
		if (m) {
			flush();
			heading = m[2] ?? '';
			body = [line];
		} else {
			body.push(line);
		}
	}
	flush();

	// Join short sections with the next one; the first heading names the joined chunk.
	const joined: NoteChunk[] = [];
	let pending: NoteChunk | null = null;
	for (const s of sections) {
		const cur: NoteChunk = pending
			? { heading: pending.heading || s.heading, text: `${pending.text}\n\n${s.text}` }
			: s;
		if (cur.text.length < MIN_CHUNK_CHARS) pending = cur;
		else {
			joined.push(cur);
			pending = null;
		}
	}
	if (pending) {
		const last = joined.at(-1);
		if (last && last.text.length + pending.text.length + 2 <= MAX_CHUNK_CHARS) {
			last.text = `${last.text}\n\n${pending.text}`;
		} else joined.push(pending);
	}

	const out: NoteChunk[] = [];
	for (const s of joined) {
		for (const text of splitLong(s.text)) {
			if (out.length >= MAX_CHUNKS) return out;
			out.push({ heading: s.heading, text });
		}
	}
	return out;
}
