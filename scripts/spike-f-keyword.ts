// Spike F (ADR-006): how TopK's keyword index treats identifiers, phrases, accents and long text.
// Creates a throwaway collection, upserts a few text documents, runs keyword queries, prints what
// matched, and deletes the collection.
//
//   TOPK_API_KEY=... npx tsx scripts/spike-f-keyword.ts [--region aws-us-east-1-elastica]
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { CollectionService } from '../src/topk/gen/topk/control/v1/collection_service_pb';
import { QueryService } from '../src/topk/gen/topk/data/v1/query_service_pb';
import { WriteService } from '../src/topk/gen/topk/data/v1/write_service_pb';
import { LogicalExpr_BinaryOp_Op } from '../src/topk/gen/topk/data/v1/expr/logical_pb';
import { Stage_SortStage_SortOrder } from '../src/topk/gen/topk/data/v1/query_pb';
import { KeywordIndexType } from '../src/topk/gen/topk/control/v1/schema_pb';
import { GrpcError, GrpcTransport, regionOrigin } from '../src/topk/grpc';
import { loadDotEnv } from '../bench/runners/types';

loadDotEnv();
const { values } = parseArgs({
	options: {
		region: { type: 'string', default: process.env.TOPK_REGION ?? 'aws-us-east-1-elastica' },
	},
});
const key = process.env.TOPK_API_KEY;
if (!key) throw new Error('TOPK_API_KEY is not set');
const transport = new GrpcTransport({
	origin: regionOrigin(values.region),
	headers: { authorization: `Bearer ${key}` },
	timeoutMs: 60_000,
});
const collection = `spike-kw-${randomUUID().slice(0, 8)}`;
const data = { 'x-topk-collection': collection };

const str = (value: string) => ({ value: { case: 'string' as const, value } });
const field = (name: string) => ({ expr: { case: 'field' as const, value: name } });

const docs: Record<string, { vault: string; text: string }> = {
	inv2291: { vault: 'v1', text: 'Invoice INV-2291, total due 4,200 EUR by 30 November.' },
	inv2290: { vault: 'v1', text: 'Credit notes for INV-2290 and INV-2292, see the summary.' },
	p99: { vault: 'v1', text: 'The p99 latency was 340 ms on version v0.16.1 of the client.' },
	rrf: { vault: 'v1', text: 'Reciprocal rank fusion combines several ranked lists into one.' },
	shuffled: { vault: 'v1', text: 'Fusion of rank lists is not reciprocal in this setup.' },
	accent: { vault: 'v1', text: 'Café crème and crème brûlée on the menu.' },
	camel: { vault: 'v1', text: 'Call runIndex() then resolveHits() from pageSource.ts.' },
	other: { vault: 'v2', text: 'A different vault also mentions INV-2291.' },
	long10k: { vault: 'v1', text: `${'filler '.repeat(1400)} needle10k` },
	long100k: { vault: 'v1', text: `${'filler '.repeat(14_000)} needle100k` },
};

interface Probe {
	label: string;
	terms: string[];
	all?: boolean;
	/** Omit the text filter and only select bm25_score. */
	noFilter?: boolean;
}

async function query(p: Probe): Promise<string> {
	const stages: unknown[] = [
		{
			stage: {
				case: 'select',
				value: {
					exprs: {
						score: {
							expr: {
								case: 'functionExpr',
								value: { func: { case: 'bm25Score', value: {} } },
							},
						},
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
										right: { expr: { case: 'literal', value: str('v1') } },
									},
								},
							},
						},
					},
				},
			},
		},
	];
	if (!p.noFilter) {
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
										all: p.all ?? true,
										terms: p.terms.map((token) => ({
											token,
											field: 'page_text',
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
	stages.push(
		{
			stage: {
				case: 'sort',
				value: {
					exprs: [{ expr: field('score'), order: Stage_SortStage_SortOrder.DESC }],
				},
			},
		},
		{ stage: { case: 'limit', value: { k: 10n } } },
	);
	try {
		const res = await transport.unary(
			QueryService.method.query,
			{ collection, query: { stages } as never, requiredLsn: lastLsn },
			data,
		);
		const ids = res.results.map((d) => {
			const id = d.fields._id?.value;
			const s = d.fields.score?.value;
			return `${id?.case === 'string' ? id.value : '?'}${s && 'value' in s ? `(${Number(s.value).toFixed(2)})` : ''}`;
		});
		return ids.length > 0 ? ids.join(', ') : '(none)';
	} catch (err) {
		return `ERROR ${err instanceof GrpcError ? `${err.code} ${err.message}` : String(err)}`.slice(
			0,
			220,
		);
	}
}

let lastLsn = '';
let created = false;
try {
	await transport.unary(CollectionService.method.createCollection, {
		name: collection,
		schema: {
			vault_id: { dataType: { dataType: { case: 'text', value: {} } }, required: true },
			page_text: {
				dataType: { dataType: { case: 'text', value: {} } },
				index: {
					index: {
						case: 'keywordIndex',
						value: { indexType: KeywordIndexType.TEXT },
					},
				},
			},
		},
	});
	created = true;
	console.log(`created ${collection}`);
	const res = await transport.unary(
		WriteService.method.upsertDocuments,
		{
			docs: Object.entries(docs).map(([id, d]) => ({
				fields: { _id: str(id), vault_id: str(d.vault), page_text: str(d.text) },
			})),
		},
		data,
	);
	lastLsn = res.lsn;
	console.log(`upserted ${Object.keys(docs).length} docs (incl. 10 KB and 100 KB texts)\n`);

	const probes: Probe[] = [
		{ label: 'identifier as one term', terms: ['INV-2291'] },
		{ label: 'identifier, lower case', terms: ['inv-2291'] },
		{ label: 'identifier split', terms: ['INV', '2291'] },
		{ label: 'number part only', terms: ['2291'] },
		{ label: 'prefix part only', terms: ['INV'] },
		{ label: 'p99', terms: ['p99'] },
		{ label: 'version string', terms: ['v0.16.1'] },
		{ label: 'version, partial', terms: ['0.16'] },
		{ label: 'phrase as all terms', terms: ['reciprocal', 'rank', 'fusion'] },
		{ label: 'phrase as one term', terms: ['reciprocal rank fusion'] },
		{ label: 'any of two terms', terms: ['p99', 'brûlée'], all: false },
		{ label: 'accented word', terms: ['brûlée'] },
		{ label: 'accent stripped', terms: ['brulee'] },
		{ label: 'camelCase identifier', terms: ['resolveHits'] },
		{ label: 'camelCase, lower', terms: ['resolvehits'] },
		{ label: 'file name', terms: ['pageSource.ts'] },
		{ label: 'needle in 10 KB text', terms: ['needle10k'] },
		{ label: 'needle in 100 KB text', terms: ['needle100k'] },
		{ label: 'bm25 without a text filter', terms: [], noFilter: true },
	];
	for (const p of probes) {
		console.log(`${p.label.padEnd(28)} [${p.terms.join(' | ')}] -> ${await query(p)}`);
	}
} finally {
	if (created) {
		await transport.unary(CollectionService.method.deleteCollection, { name: collection });
		console.log(`\ndeleted ${collection}`);
	}
	transport.close();
}
