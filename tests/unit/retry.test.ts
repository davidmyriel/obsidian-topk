import { describe, expect, it } from 'vitest';
import { GrpcCode, GrpcError, TopKErrorCode } from '../../src/topk/grpc';
import {
	classify,
	DEFAULT_RETRY_POLICY,
	jitter,
	withRetry,
	type RetryClock,
} from '../../src/topk/retry';

/** A clock that records sleeps and advances time instantly. */
function fakeClock(random = 0.9999999): RetryClock & { sleeps: number[] } {
	let t = 0;
	const sleeps: number[] = [];
	return {
		sleeps,
		now: () => t,
		sleep: (ms) => {
			sleeps.push(ms);
			t += ms;
			return Promise.resolve();
		},
		random: () => random,
	};
}

const unavailable = () => new GrpcError(GrpcCode.UNAVAILABLE, 'connection reset');
const slowDown = () =>
	new GrpcError(GrpcCode.RESOURCE_EXHAUSTED, 'slow down', 200, TopKErrorCode.SLOW_DOWN);
const lsn = () =>
	new GrpcError(GrpcCode.FAILED_PRECONDITION, 'lsn', 200, TopKErrorCode.LSN_NOT_READY);

function failing(errors: Error[], value = 'ok'): () => Promise<string> {
	const queue = [...errors];
	return () => {
		const next = queue.shift();
		return next ? Promise.reject(next) : Promise.resolve(value);
	};
}

describe('classify', () => {
	it('follows topk-rs: transient, lsn and slow down are retryable, the rest is fatal', () => {
		expect(classify(unavailable())).toBe('transient');
		expect(classify(new GrpcError(GrpcCode.CANCELLED, 'x'))).toBe('transient');
		expect(classify(lsn())).toBe('lsn');
		expect(classify(slowDown())).toBe('slow_down');
		expect(classify(new GrpcError(GrpcCode.RESOURCE_EXHAUSTED, 'quota'))).toBe('fatal');
		expect(classify(new GrpcError(GrpcCode.UNAUTHENTICATED, 'bad key'))).toBe('fatal');
		expect(classify(new GrpcError(GrpcCode.INTERNAL, 'boom'))).toBe('fatal');
		expect(classify(new Error('not grpc'))).toBe('fatal');
	});
});

describe('withRetry', () => {
	it('retries transient errors 3 times with doubling, jittered backoff', async () => {
		const clock = fakeClock();
		await expect(
			withRetry(failing([unavailable(), unavailable(), unavailable()]), { clock }),
		).resolves.toBe('ok');
		expect(clock.sleeps).toEqual([100, 200, 400]);
	});

	it('gives up after the fourth transient failure', async () => {
		const clock = fakeClock();
		await expect(
			withRetry(failing([unavailable(), unavailable(), unavailable(), unavailable()]), {
				clock,
			}),
		).rejects.toThrow('connection reset');
		expect(clock.sleeps).toHaveLength(3);
	});

	it('jitters between the initial backoff and the current ceiling', () => {
		const b = DEFAULT_RETRY_POLICY.backoff;
		expect(jitter(b, 800, () => 0)).toBe(100);
		expect(jitter(b, 800, () => 0.999999)).toBe(800);
		expect(jitter(b, 50, () => 0.5)).toBe(100);
	});

	it('backs off longer on SlowDown and retries it up to 6 times', async () => {
		const clock = fakeClock();
		await expect(
			withRetry(failing(Array.from({ length: 6 }, slowDown)), { clock }),
		).resolves.toBe('ok');
		expect(clock.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
	});

	it('retries an LSN that is not visible yet for about 2 seconds', async () => {
		const clock = fakeClock();
		await expect(
			withRetry(failing(Array.from({ length: 50 }, lsn)), { clock }),
		).rejects.toThrow('lsn');
		const total = clock.sleeps.reduce((a, b) => a + b, 0);
		expect(total).toBeGreaterThanOrEqual(2000);
		expect(total).toBeLessThan(2000 + 10_000);
	});

	it('does not retry fatal errors', async () => {
		const clock = fakeClock();
		await expect(
			withRetry(failing([new GrpcError(GrpcCode.UNAUTHENTICATED, 'bad key')]), { clock }),
		).rejects.toThrow('bad key');
		expect(clock.sleeps).toEqual([]);
	});

	it('stops when the total timeout would be exceeded', async () => {
		const clock = fakeClock();
		const policy = { ...DEFAULT_RETRY_POLICY, totalTimeoutMs: 250 };
		await expect(
			withRetry(failing([unavailable(), unavailable(), unavailable()]), { clock, policy }),
		).rejects.toThrow();
		expect(clock.sleeps).toEqual([100]);
	});
});
