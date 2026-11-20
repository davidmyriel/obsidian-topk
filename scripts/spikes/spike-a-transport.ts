// Spike A: prove the bundled gRPC transport reaches TopK from Node.
// Without TOPK_API_KEY it expects a well-formed gRPC auth error. With a key, NOT_FOUND for a
// collection that does not exist proves the key works.
// Usage: npx tsx scripts/spikes/spike-a-transport.ts [region]
import { CollectionService } from '../../src/topk/gen/topk/control/v1/collection_service_pb';
import { GrpcCode, GrpcError, GrpcTransport, regionOrigin } from '../../src/topk/grpc';

const region = process.argv[2] ?? process.env.TOPK_REGION ?? 'aws-us-east-1-elastica';
const key = process.env.TOPK_API_KEY;
const transport = new GrpcTransport({
	origin: regionOrigin(region),
	headers: key ? { authorization: `Bearer ${key}` } : {},
});

const started = performance.now();
try {
	const res = await transport.unary(CollectionService.method.getCollection, {
		name: 'spike-a-probe',
	});
	console.log(
		`OK ${region}: found ${res.collection?.name ?? '?'} in ${Math.round(performance.now() - started)} ms`,
	);
} catch (err) {
	if (!(err instanceof GrpcError)) throw err;
	console.log(
		`gRPC error from ${region} (key ${key ? 'set' : 'not set'}): code=${err.code} details="${err.details}" ` +
			`in ${Math.round(performance.now() - started)} ms`,
	);
	if (key && err.code !== GrpcCode.NOT_FOUND) process.exitCode = 1;
} finally {
	transport.close();
}
