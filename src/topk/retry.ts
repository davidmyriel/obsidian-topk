import { GrpcCode, GrpcError, TopKErrorCode } from './grpc';

// Retry policy for TopK calls, modelled on topk-rs (src/client/retry.rs, error.rs):
// connection failures and UNAVAILABLE/CANCELLED are retried 3 times with jittered exponential
// backoff (100 ms doubling to 10 s); a not-yet-visible required_lsn is retried for at least 2 s;
// the whole chain is capped at 3 minutes. Unlike the SDK, SlowDown (the server is out of capacity)
// is retried too, but with a longer backoff, because the indexer runs in the background.

export type RetryClass = 'transient' | 'lsn' | 'slow_down' | 'fatal';

export function classify(err: unknown): RetryClass {
	if (!(err instanceof GrpcError)) return 'fatal';
	if (err.topkCode === TopKErrorCode.LSN_NOT_READY) return 'lsn';
	if (err.topkCode === TopKErrorCode.SLOW_DOWN) return 'slow_down';
	if (err.code === GrpcCode.UNAVAILABLE || err.code === GrpcCode.CANCELLED) return 'transient';
	return 'fatal';
}

export interface Backoff {
	initMs: number;
	maxMs: number;
	base: number;
}

export interface RetryPolicy {
	maxRetries: number;
	totalTimeoutMs: number;
	backoff: Backoff;
	/** SlowDown gets its own, gentler schedule. */
	slowDown: { maxRetries: number; backoff: Backoff };
	/** Minimum time to keep retrying an LSN that is not visible yet. */
	lsnRetryMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 3,
	totalTimeoutMs: 180_000,
	backoff: { initMs: 100, maxMs: 10_000, base: 2 },
	slowDown: { maxRetries: 6, backoff: { initMs: 1_000, maxMs: 30_000, base: 2 } },
	lsnRetryMs: 2_000,
};

export interface RetryClock {
	now(): number;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
	/** Uniform in [0, 1). */
	random(): number;
}

export const realClock: RetryClock = {
	now: () => Date.now(),
	sleep: (ms, signal) =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
			const timer = globalThis.setTimeout(resolve, ms);
			signal?.addEventListener('abort', () => {
				globalThis.clearTimeout(timer);
				reject(new DOMException('aborted', 'AbortError'));
			});
		}),
	random: () => Math.random(),
};

/** Jittered delay in [initMs, ceiling], as topk-rs does. */
export function jitter(backoff: Backoff, ceilingMs: number, random: () => number): number {
	return (
		backoff.initMs +
		Math.floor(random() * (Math.max(ceilingMs, backoff.initMs) - backoff.initMs + 1))
	);
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		policy?: RetryPolicy;
		clock?: RetryClock;
		signal?: AbortSignal;
		onRetry?: (err: GrpcError, waitMs: number) => void;
	} = {},
): Promise<T> {
	const policy = options.policy ?? DEFAULT_RETRY_POLICY;
	const clock = options.clock ?? realClock;
	const start = clock.now();
	const attempts: Record<RetryClass, number> = { transient: 0, lsn: 0, slow_down: 0, fatal: 0 };
	const ceilings: Record<RetryClass, number> = {
		transient: policy.backoff.initMs,
		lsn: policy.backoff.initMs,
		slow_down: policy.slowDown.backoff.initMs,
		fatal: 0,
	};
	for (;;) {
		try {
			return await fn();
		} catch (err) {
			const kind = classify(err);
			if (kind === 'fatal' || !(err instanceof GrpcError)) throw err;
			const elapsed = clock.now() - start;
			const retry =
				kind === 'lsn'
					? elapsed <= policy.lsnRetryMs
					: attempts[kind] <
						(kind === 'slow_down' ? policy.slowDown.maxRetries : policy.maxRetries);
			if (!retry) throw err;
			const backoff = kind === 'slow_down' ? policy.slowDown.backoff : policy.backoff;
			const wait = jitter(backoff, ceilings[kind], () => clock.random());
			if (elapsed + wait > policy.totalTimeoutMs) throw err;
			attempts[kind]++;
			ceilings[kind] = Math.min(ceilings[kind] * backoff.base, backoff.maxMs);
			options.onRetry?.(err, wait);
			await clock.sleep(wait, options.signal);
		}
	}
}
