// Spike probes bundled to CommonJS and require()d inside Obsidian's renderer by spikes.e2e.ts,
// so the spikes exercise the real transport and renderer code, not copies.
import { CollectionService } from '../../../src/topk/gen/topk/control/v1/collection_service_pb';
import { GrpcError, GrpcTransport, regionOrigin } from '../../../src/topk/grpc';
import { domCanvasFactory } from '../../../src/util/domCanvas';
import { renderPdfPages, type PdfJsLike } from '../../../src/render/pdfRenderer';

export async function grpcProbe(
	region: string,
): Promise<{ code: number; details: string; ms: number }> {
	const transport = new GrpcTransport({ origin: regionOrigin(region), headers: {} });
	const t0 = performance.now();
	try {
		await transport.unary(CollectionService.method.getCollection, { name: 'e2e-probe' });
		return { code: 0, details: 'ok', ms: performance.now() - t0 };
	} catch (err) {
		if (!(err instanceof GrpcError)) throw err;
		return { code: err.code, details: err.details, ms: performance.now() - t0 };
	} finally {
		transport.close();
	}
}

export async function renderProbe(
	pdfjs: PdfJsLike,
	data: Uint8Array,
	longSide: number,
): Promise<{
	pages: {
		page: number;
		width: number;
		height: number;
		bytes: number;
		renderMs: number;
		encodeMs: number;
	}[];
	peakRssMb: number;
	baseRssMb: number;
}> {
	const rss = (): number => process.memoryUsage().rss / 1024 / 1024;
	const baseRssMb = rss();
	let peakRssMb = baseRssMb;
	const timer = setInterval(() => (peakRssMb = Math.max(peakRssMb, rss())), 5);
	const pages = [];
	try {
		for await (const p of renderPdfPages(pdfjs, data, domCanvasFactory, {
			longSide,
			format: 'jpeg',
			quality: 0.85,
			maxBytes: 512 * 1024,
		})) {
			peakRssMb = Math.max(peakRssMb, rss());
			pages.push({
				page: p.page,
				width: p.width,
				height: p.height,
				bytes: p.bytes.length,
				renderMs: p.renderMs,
				encodeMs: p.encodeMs,
			});
		}
	} finally {
		clearInterval(timer);
	}
	return { pages, peakRssMb, baseRssMb };
}
