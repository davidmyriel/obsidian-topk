// Debounced background indexing (ADR-005). Every vault change calls request(); the run starts once
// the vault has been quiet for `delayMs`. Changes that arrive during a run schedule one more run
// after it, so nothing is missed and runs never overlap.

export interface Timers {
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(handle: number): void;
}

export class ReindexScheduler {
	private timer: number | null = null;
	private running = false;
	private pending = false;
	private disposed = false;

	constructor(
		private readonly run: () => Promise<void>,
		private readonly delayMs: number,
		private readonly timers: Timers,
	) {}

	/** Asks for a run after the next quiet period. */
	request(): void {
		if (this.disposed) return;
		if (this.running) {
			this.pending = true;
			return;
		}
		if (this.timer !== null) this.timers.clearTimeout(this.timer);
		this.timer = this.timers.setTimeout(() => void this.fire(), this.delayMs);
	}

	get scheduled(): boolean {
		return this.timer !== null || this.pending;
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer !== null) this.timers.clearTimeout(this.timer);
		this.timer = null;
		this.pending = false;
	}

	private async fire(): Promise<void> {
		this.timer = null;
		this.running = true;
		try {
			await this.run();
		} catch {
			// The run reports its own errors; the scheduler only sequences runs.
		} finally {
			this.running = false;
			if (this.pending) {
				this.pending = false;
				this.request();
			}
		}
	}
}
