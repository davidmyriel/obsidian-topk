import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { CreateCollectionRequestSchema } from './gen/topk/control/v1/collection_service_pb';
import type { FieldSpecSchema } from './gen/topk/control/v1/schema_pb';
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
			},
		})),
	});
}

/** collection(name).delete(ids) */
export function deletePagesRequest(ids: string[]) {
	return create(DeleteDocumentsRequestSchema, { ids });
}

type LogicalInit = MessageInitShape<typeof LogicalExprSchema>;
const field = (name: string): LogicalInit => ({ expr: { case: 'field', value: name } });

/**
 * select({ score: fn.semanticSimilarity('page_image', query), content_hash, page, tile, kind })
 *   .filter(field('vault_id').eq(vaultId))
 *   .sort(field('score'), false)
 *   .limit(k)
 */
export function searchRequest(query: string, vaultId: string, k: number) {
	return create(QueryRequestSchema, {
		query: {
			stages: [
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
								content_hash: {
									expr: { case: 'logicalExpr', value: field('content_hash') },
								},
								page: { expr: { case: 'logicalExpr', value: field('page') } },
								tile: { expr: { case: 'logicalExpr', value: field('tile') } },
								kind: { expr: { case: 'logicalExpr', value: field('kind') } },
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
												right: {
													expr: { case: 'literal', value: str(vaultId) },
												},
											},
										},
									},
								},
							},
						},
					},
				},
				{
					stage: {
						case: 'sort',
						value: {
							exprs: [
								{ expr: field('score'), order: Stage_SortStage_SortOrder.DESC },
							],
						},
					},
				},
				{ stage: { case: 'limit', value: { k: BigInt(k) } } },
			],
		},
	});
}
