import {
	countPdfPages,
	encodeWithinLimit,
	renderPdfPages,
	scaledDimensions,
	scaleFor,
	type CanvasFactory,
	type ImageFormat,
	type PdfJsLike,
} from './pdfRenderer';

// Turns a vault file into upload-ready page images: every page of a PDF, or one image.

export type SourceKind = 'pdf' | 'image';

export interface DecodedImage {
	width: number;
	height: number;
	/** Whatever the canvas implementation can draw: ImageBitmap in Obsidian, Image in Node. */
	source: unknown;
	close(): void;
}

export interface RenderEnv {
	loadPdfJs(): Promise<PdfJsLike>;
	createCanvas: CanvasFactory;
	decodeImage(bytes: Uint8Array, mime: string): Promise<DecodedImage>;
	/** Extra pdf.js getDocument options, e.g. standardFontDataUrl in Node. */
	documentOptions?: Record<string, unknown>;
}

export interface PageImageOptions {
	/** Upper bound on width × height of each uploaded image (ADR-003). */
	maxPixels: number;
	quality: number;
	maxBytes: number;
}

export interface PageImage {
	page: number;
	tile: number;
	format: ImageFormat;
	bytes: Uint8Array;
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

export const SUPPORTED_EXTENSIONS = ['pdf', ...Object.keys(MIME)] as const;

export function sourceKind(extension: string): SourceKind | null {
	const ext = extension.toLowerCase();
	if (ext === 'pdf') return 'pdf';
	return ext in MIME ? 'image' : null;
}

export async function countPages(
	env: RenderEnv,
	kind: SourceKind,
	data: Uint8Array,
): Promise<number> {
	if (kind === 'image') return 1;
	return countPdfPages(await env.loadPdfJs(), data, env.documentOptions);
}

export async function* pageImages(
	env: RenderEnv,
	kind: SourceKind,
	extension: string,
	data: Uint8Array,
	options: PageImageOptions,
): AsyncGenerator<PageImage> {
	if (kind === 'pdf') {
		const pdfjs = await env.loadPdfJs();
		for await (const p of renderPdfPages(pdfjs, data, env.createCanvas, {
			maxPixels: options.maxPixels,
			format: 'jpeg',
			quality: options.quality,
			maxBytes: options.maxBytes,
			...(env.documentOptions ? { documentOptions: env.documentOptions } : {}),
		})) {
			yield { page: p.page, tile: 0, format: p.format, bytes: p.bytes };
		}
		return;
	}
	yield { page: 1, tile: 0, ...(await prepareImage(env, extension, data, options)) };
}

/**
 * JPEG or PNG that is already within the size limits is uploaded unchanged (ADR-003). Anything
 * else is scaled down to the pixel budget (never up) and re-encoded as JPEG on white.
 */
export async function prepareImage(
	env: RenderEnv,
	extension: string,
	data: Uint8Array,
	options: PageImageOptions,
): Promise<{ format: ImageFormat; bytes: Uint8Array }> {
	const ext = extension.toLowerCase();
	const mime = MIME[ext];
	if (!mime) throw new Error(`unsupported image type .${ext}`);
	const image = await env.decodeImage(data, mime);
	try {
		const passthrough: ImageFormat | null =
			ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : null;
		if (
			passthrough &&
			data.length <= options.maxBytes &&
			image.width * image.height <= options.maxPixels
		) {
			return { format: passthrough, bytes: data };
		}
		const scale = Math.min(
			1,
			scaleFor(image.width, image.height, { maxPixels: options.maxPixels }),
		);
		const { width, height } = scaledDimensions(image.width, image.height, scale);
		const canvas = env.createCanvas(width, height);
		try {
			canvas.drawImage(image.source, width, height);
			const { bytes } = await encodeWithinLimit(canvas, 1, { format: 'jpeg', ...options });
			return { format: 'jpeg', bytes };
		} finally {
			canvas.release();
		}
	} finally {
		image.close();
	}
}
