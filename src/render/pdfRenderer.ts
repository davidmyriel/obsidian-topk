// Renders PDF pages to encoded images one page at a time. pdf.js and the canvas are injected:
// Obsidian passes the result of loadPdfJs() and DOM canvases, Node tests pass pdfjs-dist and
// @napi-rs/canvas. Only the subset of the pdf.js API used here is typed.

export interface PdfViewport {
	width: number;
	height: number;
}

export interface PdfPage {
	getViewport(params: { scale: number }): PdfViewport;
	render(params: { canvasContext: unknown; canvas: unknown; viewport: PdfViewport }): {
		promise: Promise<unknown>;
	};
	cleanup(): void;
}

export interface PdfDocument {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfJsLike {
	getDocument(src: { data: Uint8Array; [option: string]: unknown }): {
		promise: Promise<PdfDocument>;
		destroy(): Promise<void>;
	};
}

export type ImageFormat = 'jpeg' | 'png';

export interface RenderCanvas {
	canvas: unknown;
	context: unknown;
	/** Encodes the canvas. quality applies to JPEG only, 0..1. */
	encode(format: ImageFormat, quality: number): Promise<Uint8Array>;
	/** Draws a decoded image (see DecodedImage.source) scaled to the given size at 0,0. */
	drawImage(source: unknown, width: number, height: number): void;
	/** Frees the backing memory, e.g. by setting width and height to 0. */
	release(): void;
}

export type CanvasFactory = (width: number, height: number) => RenderCanvas;

export interface RenderOptions {
	/** Target length of the longer side in pixels. */
	longSide: number;
	format: ImageFormat;
	/** JPEG quality, 0..1. */
	quality: number;
	/** Upper bound for the encoded size; JPEG quality is lowered in steps to fit. */
	maxBytes: number;
	/** Stop after this many pages. */
	maxPages?: number;
	/** Extra getDocument options, e.g. standardFontDataUrl in Node. */
	documentOptions?: Record<string, unknown>;
}

export interface RenderedPage {
	/** 1-based page number. */
	page: number;
	width: number;
	height: number;
	format: ImageFormat;
	quality: number;
	bytes: Uint8Array;
	renderMs: number;
	encodeMs: number;
}

export class ImageTooLargeError extends Error {
	constructor(
		readonly page: number,
		readonly size: number,
	) {
		super(`page ${page} is ${size} bytes after the lowest quality step`);
		this.name = 'ImageTooLargeError';
	}
}

/** Scale that makes the longer side of a viewport at scale 1 equal to longSide. */
export function scaleForLongSide(viewport: PdfViewport, longSide: number): number {
	return longSide / Math.max(viewport.width, viewport.height);
}

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5];

/** Opens a PDF just long enough to read its page count. */
export async function countPdfPages(
	pdfjs: PdfJsLike,
	data: Uint8Array,
	documentOptions: Record<string, unknown> = {},
): Promise<number> {
	const task = pdfjs.getDocument({
		...documentOptions,
		data: data.slice(),
		isEvalSupported: false,
	});
	try {
		return (await task.promise).numPages;
	} finally {
		await task.destroy();
	}
}

export async function* renderPdfPages(
	pdfjs: PdfJsLike,
	data: Uint8Array,
	createCanvas: CanvasFactory,
	options: RenderOptions,
	now: () => number = () => performance.now(),
): AsyncGenerator<RenderedPage> {
	// pdf.js may transfer the buffer to its worker, so hand it a copy.
	const task = pdfjs.getDocument({
		...options.documentOptions,
		data: data.slice(),
		isEvalSupported: false,
	});
	try {
		const doc = await task.promise;
		const last = Math.min(doc.numPages, options.maxPages ?? Number.POSITIVE_INFINITY);
		for (let n = 1; n <= last; n++) {
			const page = await doc.getPage(n);
			const viewport = page.getViewport({
				scale: scaleForLongSide(page.getViewport({ scale: 1 }), options.longSide),
			});
			const width = Math.round(viewport.width);
			const height = Math.round(viewport.height);
			const target = createCanvas(width, height);
			try {
				const t0 = now();
				await page.render({
					canvasContext: target.context,
					canvas: target.canvas,
					viewport,
				}).promise;
				const t1 = now();
				const { bytes, quality } = await encodeWithinLimit(target, n, options);
				yield {
					page: n,
					width,
					height,
					format: options.format,
					quality,
					bytes,
					renderMs: t1 - t0,
					encodeMs: now() - t1,
				};
			} finally {
				target.release();
				page.cleanup();
			}
		}
	} finally {
		await task.destroy();
	}
}

export async function encodeWithinLimit(
	target: RenderCanvas,
	page: number,
	options: Pick<RenderOptions, 'format' | 'quality' | 'maxBytes'>,
): Promise<{ bytes: Uint8Array; quality: number }> {
	if (options.format === 'png') {
		const bytes = await target.encode('png', 1);
		if (bytes.length > options.maxBytes) throw new ImageTooLargeError(page, bytes.length);
		return { bytes, quality: 1 };
	}
	const steps = [options.quality, ...QUALITY_STEPS.filter((q) => q < options.quality)];
	let size = 0;
	for (const quality of steps) {
		const bytes = await target.encode('jpeg', quality);
		if (bytes.length <= options.maxBytes) return { bytes, quality };
		size = bytes.length;
	}
	throw new ImageTooLargeError(page, size);
}
