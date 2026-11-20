import { imageSize } from './imageSize';
import { tileRects } from './tiles';
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
	/** Upper bound on tiles for one tall image; more fails the file (the page limit). */
	maxTiles?: number;
	/** PDF pages to skip without rendering (already uploaded). */
	skipPage?: (page: number) => boolean;
	/** Upper bound on width × height of each uploaded image (ADR-003). */
	maxPixels: number;
	quality: number;
	maxBytes: number;
}

export interface PageImage {
	page: number;
	tile: number;
	/** True for tiles of a tall image (kind image_tile). */
	tiled?: boolean;
	format: ImageFormat;
	bytes: Uint8Array;
	/** The PDF page's text layer; absent for images. */
	text?: string;
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

export function sourceKind(extension: string): SourceKind | null {
	const ext = extension.toLowerCase();
	if (ext === 'pdf') return 'pdf';
	return ext in MIME ? 'image' : null;
}

/**
 * Pages an image uploads: one per tile for a tall image. Unknown headers count as one page; the
 * decoder decides later.
 */
export function imagePageCount(data: Uint8Array): number {
	const size = imageSize(data);
	return size ? tileRects(size.width, size.height).length : 1;
}

export async function countPages(
	env: RenderEnv,
	kind: SourceKind,
	data: Uint8Array,
): Promise<number> {
	if (kind === 'image') return imagePageCount(data);
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
			...(options.skipPage ? { skipPage: options.skipPage } : {}),
			...(env.documentOptions ? { documentOptions: env.documentOptions } : {}),
		})) {
			yield { page: p.page, tile: 0, format: p.format, bytes: p.bytes, text: p.text };
		}
		return;
	}
	yield* imagePages(env, extension, data, options);
}

/**
 * One image, or its tiles when it is much taller than wide (see tiles.ts). Each tile is scaled to
 * the pixel budget on its own, so a long screenshot keeps readable detail.
 */
export async function* imagePages(
	env: RenderEnv,
	extension: string,
	data: Uint8Array,
	options: PageImageOptions,
): AsyncGenerator<PageImage> {
	if (!MIME[extension.toLowerCase()]) throw new Error(`unsupported image type .${extension}`);
	const image = await env.decodeImage(
		data,
		sniffImageMime(data) ?? MIME[extension.toLowerCase()] ?? '',
	);
	try {
		const rects = tileRects(image.width, image.height);
		if (rects.length === 1) {
			yield {
				page: 1,
				tile: 0,
				...(await encodeImage(env, image, options)),
			};
			return;
		}
		const limit = options.maxTiles ?? Number.POSITIVE_INFINITY;
		if (rects.length > limit) {
			throw new Error(
				`tall image would need ${rects.length} tiles, over the limit of ${limit}`,
			);
		}
		for (const [tile, rect] of rects.entries()) {
			const scale = Math.min(
				1,
				scaleFor(rect.width, rect.height, { maxPixels: options.maxPixels }),
			);
			const { width, height } = scaledDimensions(rect.width, rect.height, scale);
			const canvas = env.createCanvas(width, height);
			try {
				canvas.drawImage(image.source, width, height, rect);
				const { bytes } = await encodeWithinLimit(canvas, 1, {
					format: 'jpeg',
					...options,
				});
				yield { page: 1, tile, format: 'jpeg', bytes, tiled: true };
			} finally {
				canvas.release();
			}
		}
	} finally {
		image.close();
	}
}

/**
 * Every image is decoded and redrawn: scaled down to the pixel budget (never up) and encoded as JPEG
 * on white, so photo metadata such as GPS location is never uploaded (beta 2, ADR-003 amendment).
 */
export async function prepareImage(
	env: RenderEnv,
	extension: string,
	data: Uint8Array,
	options: PageImageOptions,
): Promise<{ format: ImageFormat; bytes: Uint8Array }> {
	if (!MIME[extension.toLowerCase()]) throw new Error(`unsupported image type .${extension}`);
	const image = await env.decodeImage(
		data,
		sniffImageMime(data) ?? MIME[extension.toLowerCase()] ?? '',
	);
	try {
		return await encodeImage(env, image, options);
	} finally {
		image.close();
	}
}

/**
 * Every image is decoded and re-encoded as JPEG on white, scaled down to the pixel budget (never
 * up). Uploading files unchanged would send whatever their bytes are, so a PNG named .jpg failed
 * the whole batch, transparent PNGs were embedded on black, and photos kept EXIF metadata such as
 * GPS location (ADR-003 amendment, beta 2).
 */
async function encodeImage(
	env: RenderEnv,
	image: DecodedImage,
	options: PageImageOptions,
): Promise<{ format: ImageFormat; bytes: Uint8Array }> {
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
}

/** The image type from its first bytes, so a misnamed file still decodes. */
export function sniffImageMime(bytes: Uint8Array): string | null {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
		return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	const text = (from: number, to: number): string =>
		String.fromCharCode(...bytes.subarray(from, to));
	if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
	return null;
}
