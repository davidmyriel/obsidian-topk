import type { CanvasFactory } from '../render/pdfRenderer';

// Canvas factory for Obsidian's renderer process. It uses Obsidian's createEl global, so it lives
// outside src/render, which must stay runnable in plain Node.
export const domCanvasFactory: CanvasFactory = (width, height) => {
	const canvas = createEl('canvas', { attr: { width, height } });
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas context unavailable');
	// Pages without a background would encode as black in JPEG.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, width, height);
	return {
		canvas,
		context,
		encode: (format, quality) =>
			new Promise<Uint8Array>((resolve, reject) => {
				canvas.toBlob(
					(blob) => {
						if (!blob) reject(new Error('canvas encoding failed'));
						else blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
					},
					format === 'png' ? 'image/png' : 'image/jpeg',
					quality,
				);
			}),
		release: () => {
			canvas.width = 0;
			canvas.height = 0;
		},
	};
};
