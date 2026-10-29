// Contract tests against request/response pairs recorded from live TopK by
// `npx tsx scripts/smoke.ts --record`. Each test is skipped until its fixture exists.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CollectionService } from '../../src/topk/gen/topk/control/v1/collection_service_pb';
import { QueryService } from '../../src/topk/gen/topk/data/v1/query_service_pb';
import { WriteService } from '../../src/topk/gen/topk/data/v1/write_service_pb';
import { createCollectionRequest, IMAGE_FIELD, searchRequest } from '../../src/topk/requests';

const dir = join(import.meta.dirname, '..', 'fixtures', 'topk');
const has = (name: string): boolean => existsSync(join(dir, `${name}.bin`));
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, `${name}.bin`)));

describe('recorded TopK fixtures', () => {
	it.skipIf(!has('create-collection.request'))(
		'create request matches the builder byte for byte',
		() => {
			const recorded = fromBinary(
				CollectionService.method.createCollection.input,
				read('create-collection.request'),
			);
			const rebuilt = createCollectionRequest(recorded.name);
			expect(toBinary(CollectionService.method.createCollection.input, rebuilt)).toEqual(
				read('create-collection.request'),
			);
		},
	);

	it.skipIf(!has('create-collection.response'))(
		'create response echoes the image field and its index',
		() => {
			const res = fromBinary(
				CollectionService.method.createCollection.output,
				read('create-collection.response'),
			);
			expect(res.collection?.schema[IMAGE_FIELD]?.dataType?.dataType.case).toBe('image');
		},
	);

	it.skipIf(!has('upsert-pages.response'))('upsert response carries an LSN', () => {
		const res = fromBinary(
			WriteService.method.upsertDocuments.output,
			read('upsert-pages.response'),
		);
		expect(res.lsn).not.toBe('');
	});

	it.skipIf(!has('search.request'))(
		'search request matches the builder for the same inputs',
		() => {
			const recorded = fromBinary(QueryService.method.query.input, read('search.request'));
			const select = recorded.query?.stages[0]?.stage;
			const filter = recorded.query?.stages[1]?.stage;
			if (select?.case !== 'select' || filter?.case !== 'filter')
				throw new Error('unexpected stages');
			const score = select.value.exprs.score?.expr;
			const query =
				score?.case === 'functionExpr' && score.value.func.case === 'semanticSimilarity'
					? score.value.func.value.query
					: '';
			const lit =
				filter.value.expr?.expr.case === 'logicalExpr' &&
				filter.value.expr.expr.value.expr.case === 'binaryOp'
					? filter.value.expr.expr.value.expr.value.right?.expr
					: undefined;
			const vaultId =
				lit?.case === 'literal' && lit.value.value.case === 'string'
					? lit.value.value.value
					: '';
			const rebuilt = searchRequest(query, vaultId, 20);
			if (recorded.requiredLsn !== undefined) rebuilt.requiredLsn = recorded.requiredLsn;
			expect(toBinary(QueryService.method.query.input, rebuilt)).toEqual(
				read('search.request'),
			);
		},
	);

	it.skipIf(!has('search.response'))('search response ranks the hero page first', () => {
		const res = fromBinary(QueryService.method.query.output, read('search.response'));
		const first = res.results[0]?.fields.page?.value;
		expect(first).toEqual({ case: 'i64', value: 3n });
	});
});
