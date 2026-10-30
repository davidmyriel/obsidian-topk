import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReindexScheduler, type Timers } from '../../src/indexer/scheduler';

const timers: Timers = {
	setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
	clearTimeout: (h) => clearTimeout(h),
};

describe('ReindexScheduler', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('runs once after 5 s of quiet, however many changes arrive', async () => {
		const run = vi.fn(() => Promise.resolve());
		const s = new ReindexScheduler(run, 5_000, timers);
		s.request();
		await vi.advanceTimersByTimeAsync(4_000);
		s.request(); // restarts the quiet period
		await vi.advanceTimersByTimeAsync(4_000);
		s.request();
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('queues exactly one more run for changes during a run', async () => {
		let finish: () => void = () => undefined;
		const run = vi.fn(() => new Promise<void>((r) => (finish = r)));
		const s = new ReindexScheduler(run, 5_000, timers);
		s.request();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(run).toHaveBeenCalledTimes(1);
		s.request();
		s.request();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(run).toHaveBeenCalledTimes(1); // never overlaps
		finish();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(run).toHaveBeenCalledTimes(2);
		finish();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('keeps going after a failed run and stops when disposed', async () => {
		const run = vi.fn(() => Promise.reject(new Error('boom')));
		const s = new ReindexScheduler(run, 1_000, timers);
		s.request();
		await vi.advanceTimersByTimeAsync(1_000);
		s.request();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(run).toHaveBeenCalledTimes(2);
		s.request();
		s.dispose();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(run).toHaveBeenCalledTimes(2);
		expect(s.scheduled).toBe(false);
	});
});
