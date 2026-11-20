import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { QueryRequestSchema } from '../../src/topk/gen/topk/data/v1/query_service_pb';
import { LogicalExpr_BinaryOp_Op } from '../../src/topk/gen/topk/data/v1/expr/logical_pb';
import { Stage_SortStage_SortOrder } from '../../src/topk/gen/topk/data/v1/query_pb';
import {
	createCollectionRequest,
	deletePagesRequest,
	IMAGE_FIELD,
	TEXT_FIELD,
	searchRequest,
	upsertPagesRequest,
} from '../../src/topk/requests';

describe('createCollectionRequest', () => {
	it('declares the page image as an image field with a semantic index', () => {
		const req = createCollectionRequest('pages');
		expect(req.name).toBe('pages');
		const image = req.schema[IMAGE_FIELD];
		expect(image?.dataType?.dataType.case).toBe('image');
		expect(image?.index?.index.case).toBe('semanticIndex');
		expect(req.schema.page?.dataType?.dataType.case).toBe('integer');
		expect(req.schema.vault_id?.dataType?.dataType.case).toBe('text');
		expect(Object.keys(req.schema).sort()).toEqual(
			['content_hash', 'kind', 'page', 'page_image', 'page_text', 'tile', 'vault_id'].sort(),
		);
	});

	it('declares the page text as an optional text field with a keyword index (ADR-006)', () => {
		const text = createCollectionRequest('pages').schema[TEXT_FIELD];
		expect(text?.dataType?.dataType.case).toBe('text');
		expect(text?.required).toBe(false);
		expect(text?.index?.index.case).toBe('keywordIndex');
	});
});

describe('upsertPagesRequest', () => {
	it('sends ids, metadata as string and i64 values, and raw JPEG bytes', () => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
		const req = upsertPagesRequest([
			{
				id: 'abc:15:0',
				vaultId: 'v1',
				contentHash: 'abc',
				page: 15,
				tile: 0,
				kind: 'pdf_page',
				image: { format: 'jpeg', bytes },
			},
		]);
		const fields = req.docs[0]?.fields ?? {};
		expect(fields._id?.value).toEqual({ case: 'string', value: 'abc:15:0' });
		expect(fields.page?.value).toEqual({ case: 'i64', value: 15n });
		const image = fields[IMAGE_FIELD]?.value;
		expect(image?.case).toBe('image');
		if (image?.case === 'image')
			expect(image.value.data).toEqual({ case: 'jpeg', value: bytes });
	});
});

describe('searchRequest', () => {
	it('selects semantic similarity, filters by vault, sorts descending and limits', () => {
		const req = fromBinary(
			QueryRequestSchema,
			toBinary(QueryRequestSchema, searchRequest('a diagram', 'v1', 20)),
		);
		const [select, filter, sort, limit] = req.query?.stages ?? [];
		expect(select?.stage.case).toBe('select');
		if (select?.stage.case === 'select') {
			const score = select.stage.value.exprs.score?.expr;
			expect(score?.case).toBe('functionExpr');
			if (score?.case === 'functionExpr') {
				expect(score.value.func).toEqual({
					case: 'semanticSimilarity',
					value: expect.objectContaining({
						field: IMAGE_FIELD,
						query: 'a diagram',
					}) as unknown,
				});
			}
		}
		expect(filter?.stage.case).toBe('filter');
		if (
			filter?.stage.case === 'filter' &&
			filter.stage.value.expr?.expr.case === 'logicalExpr'
		) {
			const op = filter.stage.value.expr.expr.value.expr;
			expect(op.case).toBe('binaryOp');
			if (op.case === 'binaryOp') expect(op.value.op).toBe(LogicalExpr_BinaryOp_Op.EQ);
		}
		expect(sort?.stage.case).toBe('sort');
		if (sort?.stage.case === 'sort')
			expect(sort.stage.value.exprs[0]?.order).toBe(Stage_SortStage_SortOrder.DESC);
		expect(limit?.stage).toEqual(expect.objectContaining({ case: 'limit' }));
		if (limit?.stage.case === 'limit') expect(limit.stage.value.k).toBe(20n);
	});
});

it('deletePagesRequest lists ids', () => {
	expect(deletePagesRequest(['a:1:0', 'a:2:0']).ids).toEqual(['a:1:0', 'a:2:0']);
});
