// A synthetic vault and render environment for stress tests: "PDFs" whose bytes say how many
// pages they have, a pdf.js stand-in that renders nothing, and a canvas that returns fixed-size
// JPEG-like bytes. Exercises the indexer's queueing, state and memory, not pdf.js.
import type { VaultFile, VaultReader } from '../../src/indexer/indexer';
import type { RenderEnv } from '../../src/render/pageSource';
import type { PdfJsLike } from '../../src/render/pdfRenderer';

const decoder = new TextDecoder();

export function syntheticPdf(pages: number, salt: string): Uint8Array {
	return new TextEncoder().encode(`SYNTH:${pages}:${salt}`);
}

const pdfjs: PdfJsLike = {
	getDocument: ({ data }) => {
		const [, pages] = decoder.decode(data).split(':');
		const numPages = Number(pages);
		return {
			promise: Promise.resolve({
				numPages,
				getPage: () =>
					Promise.resolve({
						getViewport: ({ scale }: { scale: number }) => ({
							width: 612 * scale,
							height: 792 * scale,
						}),
						render: () => ({ promise: Promise.resolve() }),
						cleanup: () => undefined,
						getTextContent: () => Promise.resolve({ items: [] }),
					}),
			}),
			destroy: () => Promise.resolve(),
		};
	},
};

export function syntheticEnv(pageBytes: number): RenderEnv & { rendered: number } {
	const env = {
		rendered: 0,
		loadPdfJs: () => Promise.resolve(pdfjs),
		createCanvas: () => ({
			canvas: null,
			context: null,
			encode: () => {
				env.rendered++;
				return Promise.resolve(new Uint8Array(pageBytes));
			},
			drawImage: () => undefined,
			release: () => undefined,
		}),
		decodeImage: () => Promise.reject(new Error('no images in the synthetic vault')),
	};
	return env;
}

export class SyntheticVault implements VaultReader {
	readonly files = new Map<string, Uint8Array>();
	list(): VaultFile[] {
		return [...this.files.entries()].map(([path, data]) => ({
			path,
			extension: 'pdf',
			size: data.length,
			mtime: 1,
		}));
	}
	read(path: string): Promise<Uint8Array> {
		const data = this.files.get(path);
		return data ? Promise.resolve(data) : Promise.reject(new Error(`${path} not found`));
	}
}
