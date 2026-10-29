import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	CollectionService,
	GetCollectionRequestSchema,
	GetCollectionResponseSchema,
} from '../../src/topk/gen/topk/control/v1/collection_service_pb';
import { frame, GrpcCode, GrpcError, GrpcTransport, unframe } from '../../src/topk/grpc';

// A cleartext HTTP/2 gRPC server that answers GetCollection like TopK does.
let server: http2.Http2Server;
let origin: string;
const seen: { path: string; auth: string | undefined; collection: string | undefined }[] = [];

beforeAll(async () => {
	server = http2.createServer();
	server.on('stream', (stream, headers) => {
		const chunks: Buffer[] = [];
		stream.on('data', (c: Buffer) => chunks.push(c));
		stream.on('end', () => {
			const auth = headers.authorization;
			seen.push({
				path: String(headers[':path']),
				auth,
				collection: headers['x-topk-collection'] as string,
			});
			if (auth !== 'Bearer good') {
				stream.respond(
					{
						':status': 200,
						'content-type': 'application/grpc',
						'grpc-status': '16',
						'grpc-message': 'bad%20key',
					},
					{ endStream: true },
				);
				return;
			}
			const [msg] = unframe(new Uint8Array(Buffer.concat(chunks)));
			const req = fromBinary(GetCollectionRequestSchema, msg ?? new Uint8Array());
			stream.respond(
				{ ':status': 200, 'content-type': 'application/grpc' },
				{ waitForTrailers: true },
			);
			stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
			const res = create(GetCollectionResponseSchema, {
				collection: { name: req.name, region: 'test' },
			});
			stream.end(Buffer.from(frame(toBinary(GetCollectionResponseSchema, res))));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('GrpcTransport', () => {
	it('sends a unary call with auth headers and decodes the response', async () => {
		const t = new GrpcTransport({ origin, headers: { authorization: 'Bearer good' } });
		const res = await t.unary(CollectionService.method.getCollection, { name: 'pages' });
		expect(res.collection?.name).toBe('pages');
		expect(seen.at(-1)?.path).toBe('/topk.control.v1.CollectionService/GetCollection');
		// A second call reuses the session.
		await t.unary(
			CollectionService.method.getCollection,
			{ name: 'again' },
			{ 'x-topk-collection': 'c1' },
		);
		expect(seen.at(-1)?.collection).toBe('c1');
		t.close();
	});

	it('maps a trailers-only error to GrpcError', async () => {
		const t = new GrpcTransport({ origin, headers: { authorization: 'Bearer bad' } });
		const err = await t
			.unary(CollectionService.method.getCollection, { name: 'x' })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GrpcError);
		expect((err as GrpcError).code).toBe(GrpcCode.UNAUTHENTICATED);
		expect((err as GrpcError).details).toBe('bad key');
		t.close();
	});

	it('fails with UNAVAILABLE when nothing listens', async () => {
		const t = new GrpcTransport({ origin: 'http://127.0.0.1:1', headers: {}, timeoutMs: 2000 });
		const err = await t
			.unary(CollectionService.method.getCollection, { name: 'x' })
			.catch((e: unknown) => e);
		expect((err as GrpcError).code).toBe(GrpcCode.UNAVAILABLE);
		t.close();
	});
});
