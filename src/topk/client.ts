import { GrpcCode, GrpcError, TopKErrorCode } from './grpc';
import type { PageDoc, PageKind } from './requests';

export type { PageDoc, PageKind };

export interface SearchHit {
	id: string;
	contentHash: string;
	page: number;
	tile: number;
	kind: PageKind;
	/** Unnormalised MaxSim score; higher is better. */
	score: number;
}

export interface PingResult {
	/** Whether the configured collection already exists (with a compatible schema). */
	collectionExists: boolean;
}

/** The plugin's only view of TopK. Implemented over gRPC and by an in-memory fake for tests. */
export interface TopKClient {
	/** Checks the key and the collection. Throws TopKError on auth, network or schema problems. */
	ping(): Promise<PingResult>;
	/** Creates the collection if missing; throws TopKError('schema') if it exists with another schema. */
	ensureCollection(): Promise<void>;
	/** Upserts pages, batching as needed. Returns the LSN of the last write. */
	upsertPages(pages: PageDoc[]): Promise<{ lsn: string }>;
	deletePages(ids: string[]): Promise<{ lsn: string }>;
	search(
		query: string,
		k: number,
		vaultId: string,
		options?: { requiredLsn?: string },
	): Promise<SearchHit[]>;
	close(): void;
}

export type TopKErrorKind =
	'auth' | 'network' | 'schema' | 'rate_limit' | 'quota' | 'invalid' | 'not_found' | 'unknown';

export class TopKError extends Error {
	constructor(
		readonly kind: TopKErrorKind,
		message: string,
		readonly grpcCode?: number,
	) {
		super(message);
		this.name = 'TopKError';
	}
}

/** Maps transport errors to user-facing TopK errors. */
export function toTopKError(err: unknown): TopKError {
	if (err instanceof TopKError) return err;
	if (!(err instanceof GrpcError)) {
		return new TopKError('unknown', err instanceof Error ? err.message : String(err));
	}
	switch (err.code) {
		case GrpcCode.UNAUTHENTICATED:
		case GrpcCode.PERMISSION_DENIED:
			return new TopKError(
				'auth',
				'TopK rejected the API key. Check it in settings.',
				err.code,
			);
		case GrpcCode.INVALID_ARGUMENT:
			if (/authorization/i.test(err.details)) {
				return new TopKError(
					'auth',
					'No TopK API key was sent. Set one in settings.',
					err.code,
				);
			}
			return new TopKError('invalid', `TopK rejected the request: ${err.details}`, err.code);
		case GrpcCode.UNAVAILABLE:
		case GrpcCode.DEADLINE_EXCEEDED:
			return new TopKError('network', `Could not reach TopK: ${err.details}`, err.code);
		case GrpcCode.RESOURCE_EXHAUSTED:
			// SlowDown is temporary server load; anything else is the account's quota or credits.
			return err.topkCode === TopKErrorCode.SLOW_DOWN
				? new TopKError(
						'rate_limit',
						`TopK is busy, try again shortly: ${err.details}`,
						err.code,
					)
				: new TopKError(
						'quota',
						`TopK quota exceeded. Check your credits in the TopK console: ${err.details}`,
						err.code,
					);
		case GrpcCode.NOT_FOUND:
			return new TopKError('not_found', err.details, err.code);
		default:
			return new TopKError('unknown', `TopK error ${err.code}: ${err.details}`, err.code);
	}
}

/** `${contentHash}:${page}:${tile}`, the TopK document id (ADR-002). */
export function pageId(contentHash: string, page: number, tile = 0): string {
	return `${contentHash}:${page}:${tile}`;
}

/**
 * Splits pages into upsert batches whose image bytes stay under maxBytes, the remaining request
 * overhead being small. A single page larger than maxBytes gets a batch of its own.
 */
export function batchByBytes(pages: PageDoc[], maxBytes: number): PageDoc[][] {
	const batches: PageDoc[][] = [];
	let current: PageDoc[] = [];
	let size = 0;
	for (const page of pages) {
		const bytes = page.image.bytes.length + 512;
		if (current.length > 0 && size + bytes > maxBytes) {
			batches.push(current);
			current = [];
			size = 0;
		}
		current.push(page);
		size += bytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}
