// Stage 0 smoke test against live TopK: render the 3 fixture pages, upsert them into a throwaway
// collection, run the hero query, check page 3 ranks first, and delete the collection.
//
//   TOPK_API_KEY=... npx tsx scripts/smoke.ts [--record] [--region aws-us-east-1-elastica]
//
// --record saves each request and response to tests/fixtures/topk/ (binary and JSON). Only
// message bodies are written, never headers, so the key cannot end up in a fixture.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { toBinary, toJsonString, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { CollectionService } from '../src/topk/gen/topk/control/v1/collection_service_pb';
import { QueryService } from '../src/topk/gen/topk/data/v1/query_service_pb';
import { WriteService } from '../src/topk/gen/topk/data/v1/write_service_pb';
import { GrpcCode, GrpcError, GrpcTransport, regionOrigin } from '../src/topk/grpc';
import {
	createCollectionRequest,
	deletePagesRequest,
	searchRequest,
	upsertPagesRequest,
	type PageDoc,
} from '../src/topk/requests';
import { renderPdfPages } from '../src/render/pdfRenderer';
import {
	loadNodePdfJs,
	nodeCanvasFactory,
	nodeDocumentOptions,
} from '../tests/support/node-render';

const HERO_QUERY = 'slide with the reranker architecture diagram';
const HERO_PAGE = 3;

const { values } = parseArgs({
	options: {
		record: { type: 'boolean', default: false },
		region: { type: 'string', default: process.env.TOPK_REGION ?? 'aws-us-east-1-elastica' },
		'long-side': { type: 'string', default: '1024' },
	},
});

const key = process.env.TOPK_API_KEY;
if (!key) {
	console.error('TOPK_API_KEY is not set; the smoke test needs a live TopK project.');
	process.exit(2);
}

const root = join(import.meta.dirname, '..');
const fixtures = join(root, 'tests', 'fixtures', 'topk');
const transport = new GrpcTransport({
	origin: regionOrigin(values.region),
	headers: { authorization: `Bearer ${key}` },
	timeoutMs: 60_000,
});
const collection = `smoke-${randomUUID().slice(0, 8)}`;
const data = { 'x-topk-collection': collection };

function record<T extends DescMessage>(name: string, schema: T, message: MessageShape<T>): void {
	if (!values.record) return;
	mkdirSync(fixtures, { recursive: true });
	writeFileSync(join(fixtures, `${name}.bin`), toBinary(schema, message));
	// JSON is for humans reading the fixture; bytes fields appear as base64.
	writeFileSync(
		join(fixtures, `${name}.json`),
		toJsonString(schema, message, { prettySpaces: 2 }) + '\n',
	);
}

const timings: Record<string, number> = {};
async function timed<R>(label: string, fn: () => Promise<R>): Promise<R> {
	const t0 = performance.now();
	try {
		return await fn();
	} finally {
		timings[label] = Math.round(performance.now() - t0);
	}
}

let created = false;
try {
	// 1. Render the fixture pages.
	const pdf = new Uint8Array(
		readFileSync(join(root, 'tests', 'fixtures', 'vault', 'Talks', 'talk.pdf')),
	);
	const contentHash = createHash('sha256').update(pdf).digest('hex');
	const vaultId = randomUUID();
	const pages: PageDoc[] = [];
	for await (const p of renderPdfPages(await loadNodePdfJs(), pdf, nodeCanvasFactory, {
		longSide: Number(values['long-side']),
		format: 'jpeg',
		quality: 0.85,
		maxBytes: 512 * 1024,
		documentOptions: nodeDocumentOptions,
	})) {
		pages.push({
			id: `${contentHash.slice(0, 16)}:${p.page}:0`,
			vaultId,
			contentHash,
			page: p.page,
			tile: 0,
			kind: 'pdf_page',
			image: { format: 'jpeg', bytes: p.bytes },
		});
	}
	console.log(
		`rendered ${pages.length} pages: ${pages.map((p) => p.image.bytes.length).join(', ')} bytes`,
	);

	// 2. Create a throwaway collection.
	const createReq = createCollectionRequest(collection);
	record('create-collection.request', CollectionService.method.createCollection.input, createReq);
	const createRes = await timed('create', () =>
		transport.unary(CollectionService.method.createCollection, createReq),
	);
	created = true;
	record(
		'create-collection.response',
		CollectionService.method.createCollection.output,
		createRes,
	);

	// 3. Upsert the pages; TopK embeds the images server-side.
	const upsertReq = upsertPagesRequest(pages);
	record('upsert-pages.request', WriteService.method.upsertDocuments.input, upsertReq);
	const upsertRes = await timed('upsert', () =>
		transport.unary(WriteService.method.upsertDocuments, upsertReq, data),
	);
	record('upsert-pages.response', WriteService.method.upsertDocuments.output, upsertRes);
	console.log(
		`upsert lsn ${upsertRes.lsn}, request ${toBinary(WriteService.method.upsertDocuments.input, upsertReq).length} bytes`,
	);

	// 4. Hero query, reading at the upsert's LSN.
	const queryReq = searchRequest(HERO_QUERY, vaultId, 20);
	queryReq.requiredLsn = upsertRes.lsn;
	record('search.request', QueryService.method.query.input, queryReq);
	const queryRes = await timed('query', () =>
		transport.unary(QueryService.method.query, queryReq, data),
	);
	record('search.response', QueryService.method.query.output, queryRes);

	const ranked = queryRes.results.map((doc) => {
		const page = doc.fields.page?.value;
		const score = doc.fields.score?.value;
		return {
			id: doc.fields._id?.value.case === 'string' ? doc.fields._id.value.value : '?',
			page: page?.case === 'i64' ? Number(page.value) : NaN,
			score: score?.case === 'f32' || score?.case === 'f64' ? score.value : NaN,
		};
	});
	console.log(`query "${HERO_QUERY}":`);
	for (const [i, r] of ranked.entries())
		console.log(`  ${i + 1}. page ${r.page}  score ${r.score.toFixed(4)}  ${r.id}`);

	// 5. Delete one page by id, to record the delete shape.
	const deleteReq = deletePagesRequest([pages[0]?.id ?? '']);
	record('delete-pages.request', WriteService.method.deleteDocuments.input, deleteReq);
	const deleteRes = await transport.unary(WriteService.method.deleteDocuments, deleteReq, data);
	record('delete-pages.response', WriteService.method.deleteDocuments.output, deleteRes);

	console.log(`timings ms: ${JSON.stringify(timings)}`);
	if (ranked[0]?.page === HERO_PAGE) {
		console.log(`PASS: page ${HERO_PAGE} at rank 1`);
	} else {
		console.log(`FAIL: expected page ${HERO_PAGE} at rank 1`);
		process.exitCode = 1;
	}
} catch (err) {
	if (err instanceof GrpcError) {
		console.error(`TopK error ${err.code}: ${err.details}`);
		process.exitCode = 1;
	} else {
		throw err;
	}
} finally {
	if (created) {
		try {
			await transport.unary(CollectionService.method.deleteCollection, { name: collection });
			console.log(`deleted collection ${collection}`);
		} catch (err) {
			const code = err instanceof GrpcError ? err.code : GrpcCode.UNKNOWN;
			console.error(
				`could not delete collection ${collection} (code ${code}); delete it in the console`,
			);
			process.exitCode = 1;
		}
	}
	transport.close();
}
