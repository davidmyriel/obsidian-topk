import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { CreateCollectionRequestSchema } from './gen/topk/control/v1/collection_service_pb';
import { KeywordIndexType, type FieldSpecSchema } from './gen/topk/control/v1/schema_pb';
import {
	DeleteDocumentsRequestSchema,
	UpsertDocumentsRequestSchema,
} from './gen/topk/data/v1/write_service_pb';
import { QueryRequestSchema } from './gen/topk/data/v1/query_service_pb';
import { LogicalExpr_BinaryOp_Op } from './gen/topk/data/v1/expr/logical_pb';
import { Stage_SortStage_SortOrder } from './gen/topk/data/v1/query_pb';
import type { LogicalExprSchema } from './gen/topk/data/v1/expr/logical_pb';
import type { ValueSchema } from './gen/topk/data/v1/value_pb';

// Request builders for the TopK schema in ADR-002. Each mirrors what topk-js 0.16.1 sends for the
// equivalent SDK call, so recorded fixtures and the SDK docs stay comparable.

export const IMAGE_FIELD = 'page_image';
/** The page's text layer, accent-folded, with a keyword index for exact-text search (ADR-006). */
export const TEXT_FIELD = 'page_text';
/** Weight of BM25 next to the visual score when ranking pages that contain the exact terms. */
export const HYBRID_TEXT_WEIGHT = 0.1;

export type PageKind = 'pdf_page' | 'image' | 'image_tile';

export interface PageDoc {
	/** `${contentHash}:${page}:${tile}` */
	id: string;
	vaultId: string;
	contentHash: string;
	page: number;
	tile: number;
	kind: PageKind;
	image: { format: 'jpeg' | 'png'; bytes: Uint8Array };
	/** The page's text layer, accent-folded; absent for images and pages with no text. */
	pageText?: string;
}

type FieldSpecInit = MessageInitShape<typeof FieldSpecSchema>;

const text = (required = false): FieldSpecInit => ({
	dataType: { dataType: { case: 'text', value: {} } },
	required,
});
const integer = (required = false): FieldSpecInit => ({
	dataType: { dataType: { case: 'integer', value: {} } },
	required,
});

/** collections().create(name, { ..., page_image: image().index(semanticIndex()) }) */
export function createCollectionRequest(name: string) {
	return create(CreateCollectionRequestSchema, {
		name,
		schema: {
			vault_id: text(true),
			content_hash: text(true),
			page: integer(true),
			tile: integer(true),
			kind: text(true),
			[IMAGE_FIELD]: {
				dataType: { dataType: { case: 'image', value: {} } },
				required: true,
				index: { index: { case: 'semanticIndex', value: {} } },
			},
			[TEXT_FIELD]: {
				dataType: { dataType: { case: 'text', value: {} } },
				required: false,
				index: {
					index: { case: 'keywordIndex', value: { indexType: KeywordIndexType.TEXT } },
				},
			},
		},
	});
}

type ValueInit = MessageInitShape<typeof ValueSchema>;
const str = (value: string): ValueInit => ({ value: { case: 'string', value } });
// topk-js sends JS integers as i64.
const i64 = (value: number): ValueInit => ({ value: { case: 'i64', value: BigInt(value) } });
const image = (img: PageDoc['image']): ValueInit => ({
	value: { case: 'image', value: { data: { case: img.format, value: img.bytes } } },
});

/** collection(name).upsert(docs), with image(bytes) for the page. */
export function upsertPagesRequest(pages: PageDoc[]) {
	return create(UpsertDocumentsRequestSchema, {
		docs: pages.map((p) => ({
			fields: {
				_id: str(p.id),
				vault_id: str(p.vaultId),
				content_hash: str(p.contentHash),
				page: i64(p.page),
				tile: i64(p.tile),
				kind: str(p.kind),
				[IMAGE_FIELD]: image(p.image),
				...(p.pageText ? { [TEXT_FIELD]: str(p.pageText) } : {}),
			},
		})),
	});
}

/** collection(name).delete(ids) */
export function deletePagesRequest(ids: string[]) {
	return create(DeleteDocumentsRequestSchema, { ids });
}

/** collection(name).delete(field('vault_id').eq(vaultId)) */
export function deleteVaultRequest(vaultId: string) {
	return create(DeleteDocumentsRequestSchema, {
		expr: {
			expr: {
				case: 'binaryOp',
				value: {
					op: LogicalExpr_BinaryOp_Op.EQ,
					left: field('vault_id'),
					right: { expr: { case: 'literal', value: str(vaultId) } },
				},
			},
		},
	});
}

type LogicalInit = MessageInitShape<typeof LogicalExprSchema>;
const field = (name: string): LogicalInit => ({ expr: { case: 'field', value: name } });

type StageInit = NonNullable<
	NonNullable<MessageInitShape<typeof QueryRequestSchema>['query']>['stages']
>[number];

const selectField = (name: string) => ({
	expr: { case: 'logicalExpr' as const, value: field(name) },
});

/**
 * Visual search:
 *   select({ score: fn.semanticSimilarity('page_image', query), content_hash, page, tile, kind })
 *     .filter(field('vault_id').eq(vaultId))
 *     .sort(field('score'), false)
 *     .limit(k)
 *
 * With `exactTerms`, TopK's one-query hybrid search (ADR-006): only pages whose text contains
 * every term, ranked by the visual score plus a little BM25:
 *   select({ score, text_score: fn.bm25Score(), page_text, ... })
 *     .filter(field('vault_id').eq(vaultId))
 *     .filter(match(term1, 'page_text').and(match(term2, 'page_text')))
 *     .sort(field('score').add(field('text_score').mul(HYBRID_TEXT_WEIGHT)), false)
 *     .limit(k)
 */
export function searchRequest(
	query: string,
	vaultId: string,
	k: number,
	exactTerms: string[] = [],
) {
	const hybrid = exactTerms.length > 0;
	const stages: StageInit[] = [
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
										value: { field: IMAGE_FIELD, query },
									},
								},
							},
						},
						content_hash: selectField('content_hash'),
						page: selectField('page'),
						tile: selectField('tile'),
						kind: selectField('kind'),
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
									[TEXT_FIELD]: selectField(TEXT_FIELD),
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
											field: TEXT_FIELD,
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
