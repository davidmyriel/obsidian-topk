import type {
	DescMessage,
	DescMethodUnary,
	MessageInitShape,
	MessageShape,
} from '@bufbuild/protobuf';
import { CollectionService } from './gen/topk/control/v1/collection_service_pb';
import type { Collection } from './gen/topk/control/v1/collection_pb';
import type { Document } from './gen/topk/data/v1/document_pb';
import { QueryService } from './gen/topk/data/v1/query_service_pb';
import type { Value } from './gen/topk/data/v1/value_pb';
import { WriteService } from './gen/topk/data/v1/write_service_pb';
import {
	batchByBytes,
	toTopKError,
	TopKError,
	type PageDoc,
	type PageKind,
	type PingResult,
	type SearchHit,
	type TopKClient,
} from './client';
import { GrpcCode, GrpcError, GrpcTransport, regionOrigin } from './grpc';
import { withRetry, type RetryClock, type RetryPolicy } from './retry';
import {
	createCollectionRequest,
	deletePagesRequest,
	IMAGE_FIELD,
	searchRequest,
	upsertPagesRequest,
} from './requests';

export interface GrpcTopKClientOptions {
	apiKey: string;
	collection: string;
	/** A region name such as aws-us-east-1-elastica, used when endpoint is empty. */
	region: string;
	/** Optional origin override, e.g. http://127.0.0.1:50051 for the e2e mock. */
	endpoint?: string;
	/** Upsert batch budget; TopK accepts 8 MB per request (ADR-002). */
	maxBatchBytes?: number;
	timeoutMs?: number;
	/** Overrides for tests; defaults follow topk-rs (see retry.ts). */
	retry?: { policy?: RetryPolicy; clock?: RetryClock };
}

const PAGE_KINDS: readonly PageKind[] = ['pdf_page', 'image', 'image_tile'];

export class GrpcTopKClient implements TopKClient {
	private readonly transport: GrpcTransport;
	private readonly data: Record<string, string>;

	constructor(private readonly options: GrpcTopKClientOptions) {
		this.transport = new GrpcTransport({
			origin: options.endpoint || regionOrigin(options.region),
			headers: { authorization: `Bearer ${options.apiKey}` },
			timeoutMs: options.timeoutMs ?? 60_000,
		});
		this.data = { 'x-topk-collection': options.collection };
	}

	async ping(): Promise<PingResult> {
		const collection = await this.getCollection();
		if (collection) assertSchema(collection);
		return { collectionExists: collection !== null };
	}

	async ensureCollection(): Promise<void> {
		const existing = await this.getCollection();
		if (existing) {
			assertSchema(existing);
			return;
		}
		try {
			await this.call(
				CollectionService.method.createCollection,
				createCollectionRequest(this.options.collection),
			);
		} catch (err) {
			// Another device may have created it in the meantime.
			if (err instanceof GrpcError && err.code === GrpcCode.ALREADY_EXISTS) {
				const now = await this.getCollection();
				if (now) return assertSchema(now);
			}
			throw toTopKError(err);
		}
	}

	async upsertPages(pages: PageDoc[]): Promise<{ lsn: string }> {
		let lsn = '';
		for (const batch of batchByBytes(pages, this.options.maxBatchBytes ?? 6 * 1024 * 1024)) {
			try {
				const res = await this.call(
					WriteService.method.upsertDocuments,
					upsertPagesRequest(batch),
					this.data,
				);
				lsn = res.lsn;
			} catch (err) {
				throw toTopKError(err);
			}
		}
		return { lsn };
	}

	async deletePages(ids: string[]): Promise<{ lsn: string }> {
		if (ids.length === 0) return { lsn: '' };
		try {
			const res = await this.call(
				WriteService.method.deleteDocuments,
				deletePagesRequest(ids),
				this.data,
			);
			return { lsn: res.lsn };
		} catch (err) {
			throw toTopKError(err);
		}
	}

	async search(
		query: string,
		k: number,
		vaultId: string,
		options: { requiredLsn?: string } = {},
	): Promise<SearchHit[]> {
		const req = searchRequest(query, vaultId, k);
		if (options.requiredLsn) req.requiredLsn = options.requiredLsn;
		try {
			const res = await this.call(QueryService.method.query, req, this.data);
			return res.results.flatMap((doc) => {
				const hit = parseHit(doc);
				return hit ? [hit] : [];
			});
		} catch (err) {
			throw toTopKError(err);
		}
	}

	close(): void {
		this.transport.close();
	}

	/**
	 * One unary call with retries. Every call the plugin makes is safe to repeat: upserts and
	 * deletes are by id, and a retried create that finds the collection is handled by the caller.
	 */
	private call<I extends DescMessage, O extends DescMessage>(
		method: DescMethodUnary<I, O>,
		request: MessageInitShape<I>,
		headers?: Record<string, string>,
	): Promise<MessageShape<O>> {
		return withRetry(() => this.transport.unary(method, request, headers), {
			...(this.options.retry?.policy ? { policy: this.options.retry.policy } : {}),
			...(this.options.retry?.clock ? { clock: this.options.retry.clock } : {}),
		});
	}

	private async getCollection(): Promise<Collection | null> {
		try {
			const res = await this.call(CollectionService.method.getCollection, {
				name: this.options.collection,
			});
			return res.collection ?? null;
		} catch (err) {
			if (err instanceof GrpcError && err.code === GrpcCode.NOT_FOUND) return null;
			throw toTopKError(err);
		}
	}
}

/** Rejects a collection that lacks the image field with a semantic index (ADR-002). */
export function assertSchema(collection: Collection): void {
	const field = collection.schema[IMAGE_FIELD];
	if (field?.dataType?.dataType.case !== 'image' || field.index?.index.case !== 'semanticIndex') {
		throw new TopKError(
			'schema',
			`The TopK collection "${collection.name}" exists but has no "${IMAGE_FIELD}" image field with a semantic index. ` +
				'Choose another collection name in settings.',
		);
	}
}

function str(value: Value | undefined): string | undefined {
	return value?.value.case === 'string' ? value.value.value : undefined;
}

function num(value: Value | undefined): number | undefined {
	switch (value?.value.case) {
		case 'i64':
		case 'u64':
			return Number(value.value.value);
		case 'i32':
		case 'u32':
		case 'f32':
		case 'f64':
			return value.value.value;
		default:
			return undefined;
	}
}

export function parseHit(doc: Document): SearchHit | null {
	const f = doc.fields;
	const id = str(f._id);
	const contentHash = str(f.content_hash);
	const page = num(f.page);
	const kind = str(f.kind);
	const score = num(f.score);
	if (!id || !contentHash || page === undefined || score === undefined) return null;
	if (!PAGE_KINDS.includes(kind as PageKind)) return null;
	return { id, contentHash, page, tile: num(f.tile) ?? 0, kind: kind as PageKind, score };
}
