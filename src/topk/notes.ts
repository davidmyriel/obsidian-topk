import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CollectionService } from './gen/topk/control/v1/collection_service_pb';
import { KeywordIndexType } from './gen/topk/control/v1/schema_pb';
import { LogicalExpr_BinaryOp_Op } from './gen/topk/data/v1/expr/logical_pb';
import type { LogicalExprSchema } from './gen/topk/data/v1/expr/logical_pb';
import { Stage_SortStage_SortOrder } from './gen/topk/data/v1/query_pb';
import { QueryRequestSchema, QueryService } from './gen/topk/data/v1/query_service_pb';
import { UpsertDocumentsRequestSchema, WriteService } from './gen/topk/data/v1/write_service_pb';
import type { Document } from './gen/topk/data/v1/document_pb';
import { GrpcCode, GrpcError, GrpcTransport, regionOrigin } from './grpc';
import { toTopKError } from './client';
import { HYBRID_TEXT_WEIGHT, deletePagesRequest, deleteVaultRequest } from './requests';
import { withRetry } from './retry';
import type { DescMessage, DescMethodUnary, MessageShape } from '@bufbuild/protobuf';

// Notes in their own collection, `<collection>-notes` (ADR-007): one document per section, with
// the text embedded by TopK (semantic index) and indexed for exact words (keyword index).

export const NOTE_TEXT_FIELD = 'note_text';
export const NOTE_KEYWORDS_FIELD = 'note_keywords';

/** The notes collection that belongs to a page collection. */
export const notesCollection = (pageCollection: string): string => `${pageCollection}-notes`;

export interface NoteDoc {
	/** `${vaultId}:${contentHash}:${chunk}` */
	id: string;
	vaultId: string;
	contentHash: string;
	chunk: number;
	/** The section's text, embedded by TopK. */
	text: string;
	/** The same text accent-folded, for the keyword index. */
	keywords: string;
}

export interface NoteHit {
	id: string;
	contentHash: string;
	chunk: number;
	score: number;
}

export interface NotesClient {
	ensureCollection(): Promise<void>;
	upsertNotes(docs: NoteDoc[]): Promise<{ lsn: string }>;
	deleteNotes(ids: string[]): Promise<{ lsn: string }>;
	/** Deletes every note this vault uploaded. A missing collection counts as already empty. */
	deleteVault(vaultId: string): Promise<{ lsn: string }>;
	search(
		query: string,
		k: number,
		vaultId: string,
		options?: { requiredLsn?: string; exactTerms?: string[] },
	): Promise<NoteHit[]>;
	close(): void;
}

export const noteId = (vaultId: string, contentHash: string, chunk: number): string =>
	`${vaultId}:${contentHash}:${chunk}`;

const text = (required: boolean) => ({
	dataType: { dataType: { case: 'text' as const, value: {} } },
	required,
});

export function createNotesCollectionRequest(name: string) {
	return {
		name,
		schema: {
			vault_id: text(true),
			content_hash: text(true),
			chunk: {
				dataType: { dataType: { case: 'integer' as const, value: {} } },
				required: true,
			},
			[NOTE_TEXT_FIELD]: {
				...text(true),
				index: { index: { case: 'semanticIndex' as const, value: {} } },
			},
			[NOTE_KEYWORDS_FIELD]: {
				...text(true),
				index: {
					index: {
						case: 'keywordIndex' as const,
						value: { indexType: KeywordIndexType.TEXT },
					},
				},
			},
		},
	};
}

const str = (value: string) => ({ value: { case: 'string' as const, value } });

export function upsertNotesRequest(docs: NoteDoc[]) {
	return create(UpsertDocumentsRequestSchema, {
		docs: docs.map((d) => ({
			fields: {
				_id: str(d.id),
				vault_id: str(d.vaultId),
				content_hash: str(d.contentHash),
				chunk: { value: { case: 'i64' as const, value: BigInt(d.chunk) } },
				[NOTE_TEXT_FIELD]: str(d.text),
				[NOTE_KEYWORDS_FIELD]: str(d.keywords),
			},
		})),
	});
}

type LogicalInit = MessageInitShape<typeof LogicalExprSchema>;
const field = (name: string): LogicalInit => ({ expr: { case: 'field', value: name } });

/**
 * select({ score: fn.semanticSimilarity('note_text', q), content_hash, chunk })
 *   .filter(field('vault_id').eq(vaultId))
 *   [.filter(match(terms, 'note_keywords')) and score + 0.1 · bm25, for exact terms]
 *   .sort(score desc).limit(k)
 */
export function noteSearchRequest(
	query: string,
	vaultId: string,
	k: number,
	exactTerms: string[] = [],
) {
	const hybrid = exactTerms.length > 0;
	const sel = (name: string) => ({ expr: { case: 'logicalExpr' as const, value: field(name) } });
	const stages: NonNullable<
		NonNullable<MessageInitShape<typeof QueryRequestSchema>['query']>['stages']
	> = [
		{
			stage: {
				case: 'select',
				value: {
					exprs: {
						score: {
							expr: {
								case: 'functionExpr',
								value: {
									func: {
										case: 'semanticSimilarity',
										value: { field: NOTE_TEXT_FIELD, query },
									},
								},
							},
						},
						content_hash: sel('content_hash'),
						chunk: sel('chunk'),
						...(hybrid
							? {
									text_score: {
										expr: {
											case: 'functionExpr' as const,
											value: {
												func: { case: 'bm25Score' as const, value: {} },
											},
										},
									},
								}
							: {}),
					},
				},
			},
		},
		{
			stage: {
				case: 'filter',
				value: {
					expr: {
						expr: {
							case: 'logicalExpr',
							value: {
								expr: {
									case: 'binaryOp',
									value: {
										op: LogicalExpr_BinaryOp_Op.EQ,
										left: field('vault_id'),
										right: { expr: { case: 'literal', value: str(vaultId) } },
									},
								},
							},
						},
					},
				},
			},
		},
	];
	if (hybrid) {
		stages.push({
			stage: {
				case: 'filter',
				value: {
					expr: {
						expr: {
							case: 'textExpr',
							value: {
								expr: {
									case: 'terms',
									value: {
										all: true,
										terms: exactTerms.map((token) => ({
											token,
											field: NOTE_KEYWORDS_FIELD,
											weight: 1,
										})),
									},
								},
							},
						},
					},
				},
			},
		});
	}
	const sortBy: LogicalInit = hybrid
		? {
				expr: {
					case: 'binaryOp',
					value: {
						op: LogicalExpr_BinaryOp_Op.ADD,
						left: field('score'),
						right: {
							expr: {
								case: 'binaryOp',
								value: {
									op: LogicalExpr_BinaryOp_Op.MUL,
									left: field('text_score'),
									right: {
										expr: {
											case: 'literal',
											value: {
												value: { case: 'f32', value: HYBRID_TEXT_WEIGHT },
											},
										},
									},
								},
							},
						},
					},
				},
			}
		: field('score');
	stages.push(
		{
			stage: {
				case: 'sort',
				value: { exprs: [{ expr: sortBy, order: Stage_SortStage_SortOrder.DESC }] },
			},
		},
		{ stage: { case: 'limit', value: { k: BigInt(k) } } },
	);
	return create(QueryRequestSchema, { query: { stages } });
}

export function parseNoteHit(doc: Document): NoteHit | null {
	const f = doc.fields;
	const s = (v: (typeof f)[string] | undefined) =>
		v?.value.case === 'string' ? v.value.value : undefined;
	const n = (v: (typeof f)[string] | undefined): number | undefined => {
		switch (v?.value.case) {
			case 'i64':
			case 'u64':
				return Number(v.value.value);
			case 'i32':
			case 'u32':
			case 'f32':
			case 'f64':
				return v.value.value;
			default:
				return undefined;
		}
	};
	const id = s(f._id);
	const contentHash = s(f.content_hash);
	const chunk = n(f.chunk);
	const score = n(f.score);
	if (!id || !contentHash || chunk === undefined || score === undefined) return null;
	return { id, contentHash, chunk, score };
}

/** Upserts are batched to stay well inside TopK's request size. */
const BATCH_CHARS = 1_000_000;

export class GrpcNotesClient implements NotesClient {
	private readonly transport: GrpcTransport;
	private readonly data: Record<string, string>;

	constructor(
		private readonly options: {
			apiKey: string;
			collection: string;
			region: string;
			endpoint?: string;
		},
	) {
		this.transport = new GrpcTransport({
			origin: options.endpoint || regionOrigin(options.region),
			headers: { authorization: `Bearer ${options.apiKey}` },
			timeoutMs: 60_000,
		});
		this.data = { 'x-topk-collection': options.collection };
	}

	async ensureCollection(): Promise<void> {
		try {
			await this.call(CollectionService.method.getCollection, {
				name: this.options.collection,
			});
			return;
		} catch (err) {
			if (!(err instanceof GrpcError && err.code === GrpcCode.NOT_FOUND))
				throw toTopKError(err);
		}
		try {
			await this.call(
				CollectionService.method.createCollection,
				createNotesCollectionRequest(this.options.collection),
			);
		} catch (err) {
			if (err instanceof GrpcError && err.code === GrpcCode.ALREADY_EXISTS) return;
			throw toTopKError(err);
		}
	}

	async upsertNotes(docs: NoteDoc[]): Promise<{ lsn: string }> {
		let lsn = '';
		let batch: NoteDoc[] = [];
		let size = 0;
		const send = async (): Promise<void> => {
			if (batch.length === 0) return;
			try {
				const res = await this.call(
					WriteService.method.upsertDocuments,
					upsertNotesRequest(batch),
					this.data,
				);
				lsn = res.lsn;
			} catch (err) {
				throw toTopKError(err);
			}
			batch = [];
			size = 0;
		};
		for (const d of docs) {
			const chars = d.text.length + d.keywords.length;
			if (batch.length > 0 && size + chars > BATCH_CHARS) await send();
			batch.push(d);
			size += chars;
		}
		await send();
		return { lsn };
	}

	async deleteNotes(ids: string[]): Promise<{ lsn: string }> {
		let lsn = '';
		for (let i = 0; i < ids.length; i += 1000) {
			try {
				const res = await this.call(
					WriteService.method.deleteDocuments,
					deletePagesRequest(ids.slice(i, i + 1000)),
					this.data,
				);
				lsn = res.lsn;
			} catch (err) {
				throw toTopKError(err);
			}
		}
		return { lsn };
	}

	async deleteVault(vaultId: string): Promise<{ lsn: string }> {
		try {
			const res = await this.call(
				WriteService.method.deleteDocuments,
				deleteVaultRequest(vaultId),
				this.data,
			);
			return { lsn: res.lsn };
		} catch (err) {
			const e = toTopKError(err);
			if (e.kind === 'not_found') return { lsn: '' };
			throw e;
		}
	}

	async search(
		query: string,
		k: number,
		vaultId: string,
		options: { requiredLsn?: string; exactTerms?: string[] } = {},
	): Promise<NoteHit[]> {
		const req = noteSearchRequest(query, vaultId, k, options.exactTerms);
		if (options.requiredLsn) req.requiredLsn = options.requiredLsn;
		try {
			const res = await this.call(QueryService.method.query, req, this.data);
			return res.results.flatMap((d) => {
				const hit = parseNoteHit(d);
				return hit ? [hit] : [];
			});
		} catch (err) {
			throw toTopKError(err);
		}
	}

	close(): void {
		this.transport.close();
	}

	private call<I extends DescMessage, O extends DescMessage>(
		method: DescMethodUnary<I, O>,
		request: MessageInitShape<I>,
		headers?: Record<string, string>,
	): Promise<MessageShape<O>> {
		return withRetry(() => this.transport.unary(method, request, headers));
	}
}

/** In-memory NotesClient for tests: word-overlap scoring, TopK-like exact-term filtering. */
export class FakeNotesClient implements NotesClient {
	readonly docs = new Map<string, NoteDoc>();
	collectionExists = false;
	private lsn = 0;

	ensureCollection(): Promise<void> {
		this.collectionExists = true;
		return Promise.resolve();
	}

	upsertNotes(docs: NoteDoc[]): Promise<{ lsn: string }> {
		for (const d of docs) this.docs.set(d.id, d);
		return Promise.resolve({ lsn: String(++this.lsn) });
	}

	deleteNotes(ids: string[]): Promise<{ lsn: string }> {
		for (const id of ids) this.docs.delete(id);
		return Promise.resolve({ lsn: String(++this.lsn) });
	}

	deleteVault(vaultId: string): Promise<{ lsn: string }> {
		for (const [id, d] of this.docs) if (d.vaultId === vaultId) this.docs.delete(id);
		return Promise.resolve({ lsn: String(++this.lsn) });
	}

	search(
		query: string,
		k: number,
		vaultId: string,
		options: { exactTerms?: string[] } = {},
	): Promise<NoteHit[]> {
		const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
		const q = new Set(words(query));
		const exact = (options.exactTerms ?? []).map((t) => t.toLowerCase());
		return Promise.resolve(
			[...this.docs.values()]
				.filter((d) => d.vaultId === vaultId)
				.filter((d) => {
					const tokens = new Set(words(d.keywords));
					return exact.every((t) => tokens.has(t));
				})
				.map((d) => ({
					id: d.id,
					contentHash: d.contentHash,
					chunk: d.chunk,
					score: words(d.text).filter((w) => q.has(w)).length,
				}))
				.filter((h) => h.score > 0 || exact.length > 0)
				.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
				.slice(0, k),
		);
	}

	close(): void {}
}
