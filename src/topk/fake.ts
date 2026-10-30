import {
	TopKError,
	type PageDoc,
	type PingResult,
	type SearchHit,
	type TopKClient,
} from './client';

/** Scores a stored page for a query; higher is better. */
export type FakeScorer = (query: string, page: PageDoc) => number;

/**
 * Deterministic default scorer: a stable pseudo-random score per (query, page id). It ranks
 * consistently but meaninglessly; tests that care about rankings pass their own scorer.
 */
export const hashScorer: FakeScorer = (query, page) => {
	let h = 2166136261;
	for (const ch of `${query}\u0000${page.id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return (h >>> 0) / 2 ** 32;
};

/** Builds a scorer from page descriptions keyed by `${contentHash}:${page}`: word overlap. */
export function labelScorer(labels: Record<string, string>): FakeScorer {
	const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
	return (query, page) => {
		const label = labels[`${page.contentHash}:${page.page}`];
		if (!label) return 0;
		const q = words(query);
		let score = 0;
		for (const w of words(label)) if (q.has(w)) score++;
		return score;
	};
}

export interface FakeCalls {
	ping: number;
	ensureCollection: number;
	upsertRequests: number;
	upsertedPages: number;
	deleteRequests: number;
	search: number;
}

/** In-memory TopKClient with the same contract as the gRPC client. */
export class FakeTopK implements TopKClient {
	readonly docs = new Map<string, PageDoc>();
	readonly calls: FakeCalls = {
		ping: 0,
		ensureCollection: 0,
		upsertRequests: 0,
		upsertedPages: 0,
		deleteRequests: 0,
		search: 0,
	};
	collectionExists = false;
	/** Set to make every call fail, e.g. new TopKError('auth', '...'). */
	failWith: TopKError | null = null;
	private lsn = 0;

	constructor(private readonly scorer: FakeScorer = hashScorer) {}

	ping(): Promise<PingResult> {
		this.calls.ping++;
		return this.run(() => ({ collectionExists: this.collectionExists }));
	}

	ensureCollection(): Promise<void> {
		this.calls.ensureCollection++;
		return this.run(() => {
			this.collectionExists = true;
		});
	}

	upsertPages(pages: PageDoc[]): Promise<{ lsn: string }> {
		return this.run(() => {
			this.requireCollection();
			this.calls.upsertRequests++;
			this.calls.upsertedPages += pages.length;
			for (const page of pages) this.docs.set(page.id, page);
			return { lsn: String(++this.lsn) };
		});
	}

	deletePages(ids: string[]): Promise<{ lsn: string }> {
		return this.run(() => {
			this.requireCollection();
			this.calls.deleteRequests++;
			for (const id of ids) this.docs.delete(id);
			return { lsn: String(++this.lsn) };
		});
	}

	deleteVault(vaultId: string): Promise<{ lsn: string }> {
		return this.run(() => {
			this.calls.deleteRequests++;
			if (!this.collectionExists) return { lsn: '' };
			for (const [id, doc] of this.docs) if (doc.vaultId === vaultId) this.docs.delete(id);
			return { lsn: String(++this.lsn) };
		});
	}

	search(query: string, k: number, vaultId: string): Promise<SearchHit[]> {
		this.calls.search++;
		return this.run(() => {
			this.requireCollection();
			return [...this.docs.values()]
				.filter((d) => d.vaultId === vaultId)
				.map((d) => ({
					id: d.id,
					contentHash: d.contentHash,
					page: d.page,
					tile: d.tile,
					kind: d.kind,
					score: this.scorer(query, d),
				}))
				.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
				.slice(0, k);
		});
	}

	close(): void {}

	private requireCollection(): void {
		if (!this.collectionExists) throw new TopKError('not_found', 'collection not found');
	}

	private run<T>(fn: () => T): Promise<T> {
		if (this.failWith) return Promise.reject(this.failWith);
		try {
			return Promise.resolve(fn());
		} catch (err) {
			return Promise.reject(err instanceof Error ? err : new Error(String(err)));
		}
	}
}
