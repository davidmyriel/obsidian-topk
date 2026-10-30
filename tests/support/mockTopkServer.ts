// A local, cleartext HTTP/2 gRPC server that speaks the subset of TopK's API the plugin uses,
// backed by FakeTopK. Integration tests point GrpcTopKClient at it, and the e2e suite points the
// plugin at it through the custom endpoint setting.
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import {
	create,
	fromBinary,
	toBinary,
	type DescMessage,
	type MessageShape,
} from '@bufbuild/protobuf';
import { CollectionService } from '../../src/topk/gen/topk/control/v1/collection_service_pb';
import { QueryService } from '../../src/topk/gen/topk/data/v1/query_service_pb';
import { WriteService } from '../../src/topk/gen/topk/data/v1/write_service_pb';
import type { Value } from '../../src/topk/gen/topk/data/v1/value_pb';
import {
	createCollectionRequest,
	IMAGE_FIELD,
	type PageDoc,
	type PageKind,
} from '../../src/topk/requests';
import { FakeTopK, type FakeScorer } from '../../src/topk/fake';
import { frame, GrpcCode, unframe } from '../../src/topk/grpc';

export interface MockTopK {
	origin: string;
	fake: FakeTopK;
	/** Collection names created through the API, in order. */
	created: string[];
	/** Requests received, by method path. */
	calls: string[];
	/** Fails the next `times` requests (optionally only for one method) with a gRPC status. */
	failNext(
		times: number,
		status: { code: number; message?: string; topkCode?: number; path?: string },
	): void;
	close(): Promise<void>;
}

class Status extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

const str = (v: Value | undefined): string => (v?.value.case === 'string' ? v.value.value : '');
const int = (v: Value | undefined): number => (v?.value.case === 'i64' ? Number(v.value.value) : 0);

export async function startMockTopK(options: {
	apiKey: string;
	scorer?: FakeScorer;
	port?: number;
}): Promise<MockTopK> {
	const fake = new FakeTopK(options.scorer);
	const created: string[] = [];
	const calls: string[] = [];
	const failures: { code: number; message?: string; topkCode?: number; path?: string }[] = [];
	let collection: string | null = null;

	const requireCollection = (name: string | undefined): void => {
		if (!collection || name !== collection)
			throw new Status(GrpcCode.NOT_FOUND, 'collection not found');
	};

	type Handler = (body: Uint8Array, headers: http2.IncomingHttpHeaders) => Promise<Uint8Array>;
	const unary =
		<I extends DescMessage, O extends DescMessage>(
			method: { input: I; output: O },
			fn: (
				req: MessageShape<I>,
				headers: http2.IncomingHttpHeaders,
			) => Promise<MessageShape<O>> | MessageShape<O>,
		): Handler =>
		async (body, headers) => {
			const [msg] = unframe(body);
			const res = await fn(fromBinary(method.input, msg ?? new Uint8Array()), headers);
			return toBinary(method.output, res);
		};

	const collectionMessage = (name: string) => ({
		name,
		region: 'mock',
		schema: createCollectionRequest(name).schema,
	});

	const handlers: Record<string, Handler> = {
		'/topk.control.v1.CollectionService/GetCollection': unary(
			CollectionService.method.getCollection,
			(req) => {
				requireCollection(req.name);
				return create(CollectionService.method.getCollection.output, {
					collection: collectionMessage(req.name),
				});
			},
		),
		'/topk.control.v1.CollectionService/CreateCollection': unary(
			CollectionService.method.createCollection,
			async (req) => {
				if (collection === req.name)
					throw new Status(GrpcCode.ALREADY_EXISTS, 'collection already exists');
				if (req.schema[IMAGE_FIELD]?.dataType?.dataType.case !== 'image') {
					throw new Status(
						GrpcCode.INVALID_ARGUMENT,
						'mock only supports the plugin schema',
					);
				}
				collection = req.name;
				created.push(req.name);
				await fake.ensureCollection();
				return create(CollectionService.method.createCollection.output, {
					collection: collectionMessage(req.name),
				});
			},
		),
		'/topk.control.v1.CollectionService/DeleteCollection': unary(
			CollectionService.method.deleteCollection,
			(req) => {
				requireCollection(req.name);
				collection = null;
				fake.docs.clear();
				fake.collectionExists = false;
				return create(CollectionService.method.deleteCollection.output, {});
			},
		),
		'/topk.data.v1.WriteService/UpsertDocuments': unary(
			WriteService.method.upsertDocuments,
			async (req, h) => {
				requireCollection(h['x-topk-collection'] as string | undefined);
				const pages: PageDoc[] = req.docs.map((d) => {
					const img = d.fields[IMAGE_FIELD]?.value;
					if (
						img?.case !== 'image' ||
						(img.value.data.case !== 'jpeg' && img.value.data.case !== 'png')
					) {
						throw new Status(
							GrpcCode.INVALID_ARGUMENT,
							'page_image must be a JPEG or PNG image',
						);
					}
					if (img.value.data.value.length > 512 * 1024) {
						throw new Status(GrpcCode.INVALID_ARGUMENT, 'image exceeds 512KB');
					}
					return {
						id: str(d.fields._id),
						vaultId: str(d.fields.vault_id),
						contentHash: str(d.fields.content_hash),
						page: int(d.fields.page),
						tile: int(d.fields.tile),
						kind: str(d.fields.kind) as PageKind,
						image: { format: img.value.data.case, bytes: img.value.data.value },
					};
				});
				return create(
					WriteService.method.upsertDocuments.output,
					await fake.upsertPages(pages),
				);
			},
		),
		'/topk.data.v1.WriteService/DeleteDocuments': unary(
			WriteService.method.deleteDocuments,
			async (req, h) => {
				requireCollection(h['x-topk-collection'] as string | undefined);
				// The plugin deletes either by ids or by vault_id == literal.
				const e = req.expr?.expr;
				if (
					e?.case === 'binaryOp' &&
					e.value.left?.expr.case === 'field' &&
					e.value.left.expr.value === 'vault_id'
				) {
					const right = e.value.right?.expr;
					const vaultId = right?.case === 'literal' ? str(right.value) : '';
					return create(
						WriteService.method.deleteDocuments.output,
						await fake.deleteVault(vaultId),
					);
				}
				return create(
					WriteService.method.deleteDocuments.output,
					await fake.deletePages(req.ids),
				);
			},
		),
		'/topk.data.v1.QueryService/Query': unary(QueryService.method.query, async (req, h) => {
			requireCollection(h['x-topk-collection'] as string | undefined);
			let query = '';
			let vaultId = '';
			let k = 10;
			for (const { stage } of req.query?.stages ?? []) {
				if (stage.case === 'select') {
					const e = stage.value.exprs.score?.expr;
					if (e?.case === 'functionExpr' && e.value.func.case === 'semanticSimilarity') {
						query = e.value.func.value.query;
					}
				} else if (stage.case === 'filter') {
					const e = stage.value.expr?.expr;
					if (e?.case === 'logicalExpr' && e.value.expr.case === 'binaryOp') {
						const right = e.value.expr.value.right?.expr;
						if (right?.case === 'literal') vaultId = str(right.value);
					}
				} else if (stage.case === 'limit') {
					k = Number(stage.value.k);
				}
			}
			const hits = await fake.search(query, k, vaultId);
			return create(QueryService.method.query.output, {
				results: hits.map((hit) => ({
					fields: {
						_id: { value: { case: 'string' as const, value: hit.id } },
						content_hash: {
							value: { case: 'string' as const, value: hit.contentHash },
						},
						page: { value: { case: 'i64' as const, value: BigInt(hit.page) } },
						tile: { value: { case: 'i64' as const, value: BigInt(hit.tile) } },
						kind: { value: { case: 'string' as const, value: hit.kind } },
						score: { value: { case: 'f32' as const, value: hit.score } },
					},
				})),
			});
		}),
	};

	const server = http2.createServer();
	const sessions = new Set<http2.ServerHttp2Session>();
	server.on('session', (session) => {
		sessions.add(session);
		session.on('close', () => sessions.delete(session));
	});
	server.on('stream', (stream, headers) => {
		const chunks: Buffer[] = [];
		stream.on('data', (c: Buffer) => chunks.push(c));
		stream.on('end', () => {
			const fail = (code: number, message: string, topkCode?: number): void => {
				stream.respond(
					{
						':status': 200,
						'content-type': 'application/grpc',
						'grpc-status': String(code),
						'grpc-message': encodeURIComponent(message),
						...(topkCode ? { 'x-topk-error-code': String(topkCode) } : {}),
					},
					{ endStream: true },
				);
			};
			const path = String(headers[':path']);
			// Test control endpoint for e2e specs, which run in another process:
			// POST /mock/fail?times=N&code=C[&topkCode=T][&path=/svc/Method]
			if (path.startsWith('/mock/fail')) {
				const q = new URL(path, 'http://mock').searchParams;
				const status = {
					code: Number(q.get('code') ?? 14),
					...(q.get('topkCode') ? { topkCode: Number(q.get('topkCode')) } : {}),
					...(q.get('path') ? { path: q.get('path') ?? '' } : {}),
				};
				for (let i = 0; i < Number(q.get('times') ?? 1); i++) failures.push(status);
				stream.respond({ ':status': 204 }, { endStream: true });
				return;
			}
			calls.push(path);
			const injected = failures.findIndex((f) => !f.path || f.path === path);
			if (injected >= 0) {
				const [f] = failures.splice(injected, 1);
				if (f) return fail(f.code, f.message ?? 'injected failure', f.topkCode);
			}
			const auth = headers.authorization;
			if (!auth) return fail(GrpcCode.INVALID_ARGUMENT, 'authorization header not provided');
			if (auth !== `Bearer ${options.apiKey}`)
				return fail(GrpcCode.UNAUTHENTICATED, 'Invalid api key');
			const handler = handlers[String(headers[':path'])];
			if (!handler)
				return fail(
					GrpcCode.UNIMPLEMENTED,
					`mock does not implement ${String(headers[':path'])}`,
				);
			handler(new Uint8Array(Buffer.concat(chunks)), headers).then(
				(res) => {
					stream.respond(
						{ ':status': 200, 'content-type': 'application/grpc' },
						{ waitForTrailers: true },
					);
					stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
					stream.end(Buffer.from(frame(res)));
				},
				(err: unknown) => {
					if (err instanceof Status) fail(err.code, err.message);
					else fail(GrpcCode.INTERNAL, err instanceof Error ? err.message : String(err));
				},
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		origin,
		fake,
		created,
		calls,
		failNext: (times, status) => {
			for (let i = 0; i < times; i++) failures.push(status);
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				// Drop idle client sessions so close() does not wait for them.
				for (const s of sessions) s.destroy();
			}),
	};
}
