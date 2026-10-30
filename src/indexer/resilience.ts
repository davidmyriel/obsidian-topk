import { TopKError } from '../topk/client';

// Keeps an indexing run going through outages. When an attempt fails because TopK is unreachable
// or busy (after the client's own retries), the run pauses, waits for the connection or a timer,
// and tries again. Progress is saved per file, so each new attempt skips what is already done.

/** Errors worth waiting out rather than reporting. */
export function isPausable(err: unknown): boolean {
	return err instanceof TopKError && (err.kind === 'network' || err.kind === 'rate_limit');
}

export async function runUntilDone<T>(
	attempt: (n: number) => Promise<T>,
	options: {
		/** Resolves when it is worth trying again; rejects or throws if aborted. */
		waitForRetry: (signal?: AbortSignal) => Promise<void>;
		signal?: AbortSignal;
		onPause?: (err: TopKError) => void;
		onResume?: () => void;
	},
): Promise<T> {
	for (let n = 0; ; n++) {
		try {
			return await attempt(n);
		} catch (err) {
			if (options.signal?.aborted || !isPausable(err)) throw err;
			options.onPause?.(err as TopKError);
			await options.waitForRetry(options.signal);
			if (options.signal?.aborted) throw err;
			options.onResume?.();
		}
	}
}
