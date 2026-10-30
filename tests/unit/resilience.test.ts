import { describe, expect, it } from 'vitest';
import { isPausable, runUntilDone } from '../../src/indexer/resilience';
import { TopKError } from '../../src/topk/client';

describe('runUntilDone', () => {
	it('pauses on network and rate-limit errors, then resumes until it succeeds', async () => {
		const errors = [new TopKError('network', 'offline'), new TopKError('rate_limit', 'busy')];
		const events: string[] = [];
		const result = await runUntilDone(
			(n) =>
				n < errors.length
					? Promise.reject(errors[n] as Error)
					: Promise.resolve(`done after ${n}`),
			{
				waitForRetry: () => {
					events.push('wait');
					return Promise.resolve();
				},
				onPause: (e) => events.push(`pause:${e.kind}`),
				onResume: () => events.push('resume'),
			},
		);
		expect(result).toBe('done after 2');
		expect(events).toEqual([
			'pause:network',
			'wait',
			'resume',
			'pause:rate_limit',
			'wait',
			'resume',
		]);
	});

	it('reports auth, quota and other errors immediately', async () => {
		for (const err of [
			new TopKError('auth', 'bad key'),
			new TopKError('quota', 'no credits'),
			new Error('bug'),
		]) {
			await expect(
				runUntilDone(() => Promise.reject(err), {
					waitForRetry: () => Promise.reject(new Error('should not wait')),
				}),
			).rejects.toBe(err);
		}
		expect(isPausable(new TopKError('network', 'x'))).toBe(true);
		expect(isPausable(new TopKError('schema', 'x'))).toBe(false);
	});

	it('stops waiting when cancelled', async () => {
		const controller = new AbortController();
		const offline = new TopKError('network', 'offline');
		await expect(
			runUntilDone(() => Promise.reject(offline), {
				signal: controller.signal,
				waitForRetry: () => {
					controller.abort();
					return Promise.resolve();
				},
			}),
		).rejects.toBe(offline);
	});
});
