import {
	encodeWithinLimit,
	scaleForLongSide,
	type CanvasFactory,
	type PdfJsLike,
} from './pdfRenderer';

// Thumbnails and text snippets for search results. Snippets come from the PDF's own text layer
// on this device and are for display only; they are never sent to TopK.

export interface PagePreview {
	/** JPEG thumbnail, or null when thumbnails were not requested. */
	thumbnail: Uint8Array | null;
	/** First text on the page, collapsed to one line; empty for scanned pages. */
	snippet: string;
}

/** Collapses a page's text items into one line of at most maxLength characters. */
export function snippetFromItems(items: unknown[], maxLength: number): string {
	const text = items
		.map((item) =>
			typeof item === 'object' && item !== null && 'str' in item ? String(item.str) : '',
		)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export async function pdfPagePreview(
	pdfjs: PdfJsLike,
	data: Uint8Array,
	pageNumber: number,
	createCanvas: CanvasFactory,
	options: {
		thumbnailLongSide: number | null;
		snippetLength: number;
		documentOptions?: Record<string, unknown>;
	},
): Promise<PagePreview> {
	const task = pdfjs.getDocument({
		...options.documentOptions,
		data: data.slice(),
		isEvalSupported: false,
	});
	try {
		const doc = await task.promise;
		const page = await doc.getPage(pageNumber);
		try {
			const snippet = snippetFromItems(
				(await page.getTextContent()).items,
				options.snippetLength,
			);
			if (options.thumbnailLongSide === null) return { thumbnail: null, snippet };
			const viewport = page.getViewport({
				scale: scaleForLongSide(page.getViewport({ scale: 1 }), options.thumbnailLongSide),
			});
			const target = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
			try {
				await page.render({
					canvasContext: target.context,
					canvas: target.canvas,
					viewport,
				}).promise;
				const { bytes } = await encodeWithinLimit(target, pageNumber, {
					format: 'jpeg',
					quality: 0.8,
					maxBytes: Number.POSITIVE_INFINITY,
				});
				return { thumbnail: bytes, snippet };
			} finally {
				target.release();
			}
		} finally {
			page.cleanup();
		}
	} finally {
		await task.destroy();
	}
}
