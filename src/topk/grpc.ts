import * as http2 from 'http2';
import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageShape } from '@bufbuild/protobuf';

// Minimal unary gRPC client over Node's http2 module. TopK only accepts gRPC over HTTP/2
// (HTTP/1.1 gets a 464 from its load balancer), so Obsidian's requestUrl cannot reach it.
// See docs/adr/001-topk-transport.md.

/** gRPC status codes used by the client. https://grpc.github.io/grpc/core/md_doc_statuscodes.html */
export const GrpcCode = {
	OK: 0,
	CANCELLED: 1,
	UNKNOWN: 2,
	INVALID_ARGUMENT: 3,
	DEADLINE_EXCEEDED: 4,
	NOT_FOUND: 5,
	ALREADY_EXISTS: 6,
	PERMISSION_DENIED: 7,
	RESOURCE_EXHAUSTED: 8,
	FAILED_PRECONDITION: 9,
	ABORTED: 10,
	UNIMPLEMENTED: 12,
	INTERNAL: 13,
	UNAVAILABLE: 14,
	UNAUTHENTICATED: 16,
} as const;

export class GrpcError extends Error {
	constructor(
		readonly code: number,
		readonly details: string,
		readonly httpStatus?: number,
	) {
		super(`gRPC ${code}: ${details}`);
		this.name = 'GrpcError';
	}
}

/** Prefixes a protobuf message with the 5-byte gRPC frame header (uncompressed). */
export function frame(message: Uint8Array): Uint8Array {
	const out = new Uint8Array(5 + message.length);
	new DataView(out.buffer).setUint32(1, message.length, false);
	out.set(message, 5);
	return out;
}

/** Splits a gRPC response body into its message payloads. Throws on a truncated frame. */
export function unframe(body: Uint8Array): Uint8Array[] {
	const messages: Uint8Array[] = [];
	const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
	let offset = 0;
	while (offset < body.length) {
		if (offset + 5 > body.length)
			throw new GrpcError(GrpcCode.INTERNAL, 'truncated frame header');
		if (body[offset] !== 0)
			throw new GrpcError(GrpcCode.INTERNAL, 'compressed frames are not supported');
		const length = view.getUint32(offset + 1, false);
		const start = offset + 5;
		if (start + length > body.length)
			throw new GrpcError(GrpcCode.INTERNAL, 'truncated frame body');
		messages.push(body.subarray(start, start + length));
		offset = start + length;
	}
	return messages;
}

type HeaderValue = string | string[] | number | undefined;

/**
 * Reads grpc-status from trailers, or from headers for a "trailers-only" response.
 * Returns null when the status is OK.
 */
export function statusError(
	headers: Record<string, HeaderValue>,
	trailers: Record<string, HeaderValue>,
): GrpcError | null {
	const raw = trailers['grpc-status'] ?? headers['grpc-status'];
	const httpStatus = Number(headers[':status'] ?? 0) || undefined;
	if (raw === undefined) {
		return new GrpcError(
			GrpcCode.UNKNOWN,
			`missing grpc-status (HTTP ${httpStatus ?? '?'})`,
			httpStatus,
		);
	}
	const code = Number(Array.isArray(raw) ? raw[0] : raw);
	if (code === GrpcCode.OK) return null;
	const message = trailers['grpc-message'] ?? headers['grpc-message'];
	const text = typeof message === 'string' ? safeDecode(message) : '';
	return new GrpcError(code, text, httpStatus);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** The data and control plane origin for a TopK region, e.g. aws-us-east-1-elastica. */
export function regionOrigin(region: string, host = 'topk.io'): string {
	return `https://${region}.api.${host}`;
}

export interface GrpcTransportOptions {
	/** Origin such as https://aws-us-east-1-elastica.api.topk.io */
	origin: string;
	/** Headers sent with every call, e.g. authorization. */
	headers: Record<string, string>;
	timeoutMs?: number;
}

export class GrpcTransport {
	private session: http2.ClientHttp2Session | null = null;
	private inFlight = 0;

	constructor(private readonly options: GrpcTransportOptions) {}

	async unary<I extends DescMessage, O extends DescMessage>(
		method: DescMethodUnary<I, O>,
		request: MessageInitShape<I>,
		extraHeaders: Record<string, string> = {},
	): Promise<MessageShape<O>> {
		const body = toBinary(method.input, create(method.input, request));
		const path = `/${method.parent.typeName}/${method.name}`;
		const response = await this.call(path, frame(body), extraHeaders);
		const [message] = unframe(response);
		return fromBinary(method.output, message ?? new Uint8Array());
	}

	/** Sends one framed request and resolves with the raw response body. */
	call(
		path: string,
		body: Uint8Array,
		extraHeaders: Record<string, string> = {},
	): Promise<Uint8Array> {
		const session = this.connect();
		this.inFlight++;
		session.ref();
		const done = (): void => {
			// An idle connection must not keep Node (tests, scripts) alive.
			if (--this.inFlight === 0) session.unref();
		};
		return new Promise<Uint8Array>((resolve, reject) => {
			const stream = session.request({
				':method': 'POST',
				':path': path,
				'content-type': 'application/grpc',
				te: 'trailers',
				...this.options.headers,
				...extraHeaders,
			});
			stream.setTimeout(this.options.timeoutMs ?? 30_000, () => {
				stream.close(http2.constants.NGHTTP2_CANCEL);
				reject(new GrpcError(GrpcCode.DEADLINE_EXCEEDED, `timed out calling ${path}`));
			});
			let headers: Record<string, HeaderValue> = {};
			let trailers: Record<string, HeaderValue> = {};
			const chunks: Buffer[] = [];
			stream.on('response', (h) => (headers = h));
			stream.on('trailers', (t: http2.IncomingHttpHeaders) => (trailers = t));
			stream.on('data', (chunk: Buffer) => chunks.push(chunk));
			stream.on('error', (err: Error) =>
				reject(new GrpcError(GrpcCode.UNAVAILABLE, err.message)),
			);
			stream.on('end', () => {
				const error = statusError(headers, trailers);
				if (error) reject(error);
				else resolve(new Uint8Array(Buffer.concat(chunks)));
			});
			stream.end(body);
		}).finally(done);
	}

	close(): void {
		this.session?.close();
		this.session = null;
	}

	private connect(): http2.ClientHttp2Session {
		if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
		const session = http2.connect(this.options.origin);
		session.on('error', () => {
			if (this.session === session) this.session = null;
		});
		session.on('close', () => {
			if (this.session === session) this.session = null;
		});
		this.session = session;
		return session;
	}
}
