import { TopKError, type PageDoc, type TopKClient } from '../topk/client';

// Buffers page images across files and keeps up to `concurrency` upsert requests in flight.
// Each finished batch is reported through onBatch, so callers can mark a file indexed only when
// all of its pages have landed. If TopK rejects a batch's content as invalid, its pages are retried
// one by one and only the rejected pages go to onReject, so one bad page cannot block the rest.
// Any other upload error stops the uploader: later calls rethrow it.

export interface UploaderOptions {
	concurrency: number;
	/** Start a request once this many image bytes are buffered. */
	flushBytes: number;
}

export class Uploader {
	private buffer: PageDoc[] = [];
	private buffered = 0;
	private readonly inflight = new Set<Promise<void>>();
	private failure: { error: unknown } | null = null;
	/** Highest number of requests in flight at once; for tests. */
	maxInflight = 0;

	constructor(
		private readonly client: TopKClient,
		private readonly options: UploaderOptions,
		private readonly onBatch: (pages: PageDoc[], lsn: string) => void | Promise<void>,
		private readonly onReject: (
			page: PageDoc,
			error: TopKError,
		) => void | Promise<void> = () => {
			throw new Error('a page was rejected and no onReject handler is set');
		},
	) {}

	/** Uploads a batch; on an invalid-content rejection, isolates the bad pages. */
	private async send(batch: PageDoc[]): Promise<void> {
		try {
			const { lsn } = await this.client.upsertPages(batch);
			await this.onBatch(batch, lsn);
		} catch (error) {
			if (!(error instanceof TopKError) || error.kind !== 'invalid') throw error;
			if (batch.length === 1 && batch[0]) {
				await this.onReject(batch[0], error);
				return;
			}
			for (const page of batch) await this.send([page]);
		}
	}

	async add(page: PageDoc): Promise<void> {
		this.throwIfFailed();
		this.buffer.push(page);
		this.buffered += page.image.bytes.length;
		if (this.buffered >= this.options.flushBytes) await this.flush();
	}

	/** Sends whatever is buffered, waiting for a free slot first. */
	async flush(): Promise<void> {
		this.throwIfFailed();
		if (this.buffer.length === 0) return;
		const batch = this.buffer;
		this.buffer = [];
		this.buffered = 0;
		while (this.inflight.size >= Math.max(1, this.options.concurrency)) {
			await Promise.race(this.inflight);
		}
		this.throwIfFailed();
		const request: Promise<void> = this.send(batch)
			.catch((error: unknown) => {
				this.failure ??= { error };
			})
			.finally(() => this.inflight.delete(request));
		this.inflight.add(request);
		this.maxInflight = Math.max(this.maxInflight, this.inflight.size);
	}

	/** Flushes and waits for every request; rethrows the first upload error. */
	async drain(): Promise<void> {
		await this.flush();
		await Promise.all(this.inflight);
		this.throwIfFailed();
	}

	/** Drops buffered pages and waits for requests already sent, without rethrowing. */
	async abandon(): Promise<void> {
		this.buffer = [];
		this.buffered = 0;
		await Promise.all(this.inflight);
	}

	get error(): unknown {
		return this.failure?.error;
	}

	private throwIfFailed(): void {
		if (this.failure) throw this.failure.error;
	}
}
