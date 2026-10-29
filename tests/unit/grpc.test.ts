import { describe, expect, it } from 'vitest';
import {
	frame,
	GrpcCode,
	GrpcError,
	regionOrigin,
	statusError,
	unframe,
} from '../../src/topk/grpc';

describe('gRPC framing', () => {
	it('round-trips messages through frame and unframe', () => {
		const a = frame(new Uint8Array([1, 2, 3]));
		const b = frame(new Uint8Array([]));
		expect(Array.from(a.subarray(0, 5))).toEqual([0, 0, 0, 0, 3]);
		const joined = new Uint8Array([...a, ...b]);
		expect(unframe(joined).map((m) => Array.from(m))).toEqual([[1, 2, 3], []]);
	});

	it('rejects truncated and compressed frames', () => {
		expect(() => unframe(new Uint8Array([0, 0, 0]))).toThrow(GrpcError);
		expect(() => unframe(new Uint8Array([0, 0, 0, 0, 4, 1]))).toThrow(/truncated/);
		expect(() => unframe(new Uint8Array([1, 0, 0, 0, 0]))).toThrow(/compressed/);
	});
});

describe('statusError', () => {
	it('returns null for OK in trailers', () => {
		expect(statusError({ ':status': 200 }, { 'grpc-status': '0' })).toBeNull();
	});

	it('reads a trailers-only error from headers and decodes the message', () => {
		const err = statusError(
			{
				':status': 200,
				'grpc-status': '3',
				'grpc-message': 'authorization%20header%20not%20provided',
			},
			{},
		);
		expect(err?.code).toBe(GrpcCode.INVALID_ARGUMENT);
		expect(err?.details).toBe('authorization header not provided');
	});

	it('reports a missing status with the HTTP status, e.g. a 464 from a load balancer', () => {
		const err = statusError({ ':status': 464 }, {});
		expect(err?.code).toBe(GrpcCode.UNKNOWN);
		expect(err?.httpStatus).toBe(464);
	});
});

it('builds the regional origin the way topk-rs does', () => {
	expect(regionOrigin('aws-us-east-1-elastica')).toBe(
		'https://aws-us-east-1-elastica.api.topk.io',
	);
});
