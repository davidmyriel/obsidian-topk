# Spike A: TopK transport inside Obsidian

Date: 2026-10-29. Sources: `topk-js` 0.16.1 from npm, the TopK SDK repo at tag v0.16.1 (`4864a16`),
docs.topk.io content in that repo (`docs/`), and live probes against the three public regions.

## Question

Can `topk-js` 0.16.1 be bundled into `main.js` and called from Obsidian's Electron renderer? If not,
can the plugin call TopK's HTTP API through `requestUrl`?

## Findings

1. **`topk-js` is a native addon.** It is built with napi-rs from Rust (`topk-js/Cargo.toml`,
   `"napi"` in `package.json`). `index.js` picks a per-platform package such as `topk-js-darwin-arm64`,
   which contains a `.node` shared library (4.2 MB for darwin-arm64, 8.7 MB for darwin-universal).
2. **It does not bundle.** `esbuild --bundle` fails with
   `No loader is configured for ".node" files: node_modules/topk-js-darwin-universal/topk-js.darwin-universal.node`.
   With `--loader:.node=file` it emits the binaries next to the bundle, which a plugin cannot ship:
   an Obsidian release is only `main.js`, `manifest.json` and `styles.css`, and downloading native
   code at runtime would break the store's "no remote code" policy. It would also blow the 1.5 MB
   bundle budget many times over.
3. **There is no REST or HTTP/1.1 API.** The SDK (`topk-rs/src/client`) uses tonic gRPC over HTTP/2.
   The endpoint is `https://{region}.api.topk.io` (`ClientConfig::endpoint`), auth is
   `authorization: Bearer <key>`, and data-plane calls add an `x-topk-collection: <name>` header
   (`topk-rs/src/client/mod.rs:72`). The docs mention no REST, gRPC-Web or Connect endpoint.
4. **`requestUrl` cannot reach TopK.** Every HTTP/1.1 request, whatever the content type
   (`application/grpc`, `application/grpc-web+proto`, `application/json`), gets
   `HTTP/1.1 464` — the AWS load balancer's "incompatible protocol" answer for a gRPC-only target.
   An HTTP/2 gRPC request without a key gets `HTTP/2 200`, `grpc-status: 3`,
   `grpc-message: authorization header not provided`.
5. **A small pure-TypeScript gRPC client works.** `src/topk/grpc.ts` frames protobuf messages and
   sends them over Node's built-in `http2` module. The codec is generated from TopK's own `.proto`
   files (vendored in `vendor/topk-protos`, MIT) with `@bufbuild/protobuf` 2.16.0, which has no
   `eval` or `new Function`. Results of `npx tsx scripts/spikes/spike-a-transport.ts <region>`:

    | Region                    | Key     | Result                                     | Time   |
    | ------------------------- | ------- | ------------------------------------------ | ------ |
    | aws-us-east-1-elastica    | none    | gRPC 3 "authorization header not provided" | 132 ms |
    | aws-eu-central-1-monstera | none    | gRPC 3 "authorization header not provided" | 628 ms |
    | gcp-us-east4-aloe         | none    | gRPC 3 "authorization header not provided" | 124 ms |
    | aws-us-east-1-elastica    | invalid | gRPC 16 UNAUTHENTICATED "Invalid api key"  | 90 ms  |

    These are well-formed answers from TopK's gRPC service, so request framing, HTTP/2 and status
    parsing all work. A call with a real key is still pending (no `TOPK_API_KEY` in this environment).

6. **Bundle cost.** The transport plus the generated collection, write and query services is
   94 KB minified (28 KB gzipped).
7. **Inside Obsidian: confirmed.** The same `GrpcTransport`, bundled to CommonJS and loaded in the
   renderer of Obsidian 1.11.4 and 1.14.5, got TopK's `grpc-status: 3` answer in 85–126 ms
   (`tests/e2e/spikes.e2e.ts`, see `docs/spikes/D-e2e-harness.md`). esbuild already marks Node
   built-ins such as `http2` as external, and Obsidian's renderer provides them.

## Tests

- `tests/unit/grpc.test.ts`: framing, status parsing (trailers-only errors, the 464 case), region origin.
- `tests/integration/grpc-transport.test.ts`: a local cleartext HTTP/2 gRPC server; unary success,
  session reuse, the collection header, UNAUTHENTICATED mapping, and an unreachable host.

## Error codes for "Test connection" (Stage 1)

| Situation              | gRPC code                                               |
| ---------------------- | ------------------------------------------------------- |
| No key                 | 3 INVALID_ARGUMENT, "authorization header not provided" |
| Wrong key              | 16 UNAUTHENTICATED, "Invalid api key"                   |
| Offline or DNS failure | 14 UNAVAILABLE (raised by the transport)                |
