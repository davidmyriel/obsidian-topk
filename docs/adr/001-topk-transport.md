# ADR-001: TopK transport

- Status: Accepted by Dave on 2026-10-29
- Date: 2026-10-29
- Spike: `docs/spikes/A-topk-transport.md`

## Context

PLAN.md assumed two options: bundle `topk-js` 0.16.1, or call TopK's HTTP API through Obsidian's
`requestUrl`. Spike A showed that neither works:

- `topk-js` is a napi-rs native addon with 4–9 MB `.node` binaries per platform. It cannot be
  bundled into `main.js`, and a plugin may not ship or download native code.
- TopK exposes only gRPC over HTTP/2. HTTP/1.1 requests get `464` from its load balancer, and
  `requestUrl` cannot send HTTP/2 gRPC or read trailers.

## Decision

The plugin talks to TopK with its own small gRPC client:

- **Wire:** unary gRPC calls over Node's built-in `http2` module (`src/topk/grpc.ts`), one cached
  session per origin, `https://{region}.api.topk.io`, headers `authorization: Bearer <key>` and
  `x-topk-collection: <name>` exactly as `topk-rs` sends them.
- **Codec:** TypeScript generated from TopK's own `.proto` files, vendored at the SDK's v0.16.1 tag in
  `vendor/topk-protos`, with `@bufbuild/protobuf` (`npm run proto`). No hand-written field numbers.
- **Interface:** everything above sits behind the `TopKClient` interface from PLAN.md; the in-memory
  fake implements the same interface for tests.
- `src/topk` stays free of `obsidian` imports, so the client runs unchanged in Vitest and scripts.

## Consequences

- No CORS issue: Node's `http2` is not subject to the renderer's CORS rules, like `requestUrl`.
- The plugin is desktop-only (already `isDesktopOnly: true`). A Stage 4 mobile search would need
  a different transport (for example a TopK HTTP/1.1 or gRPC-Web endpoint, if TopK adds one).
- PLAN.md's privacy rule "requestUrl calls only the configured TopK endpoint" becomes "the gRPC
  transport connects only to `*.api.topk.io` or the configured host"; the bundle host test stays.
- When TopK changes its protos we must re-vendor and regenerate. Pinning the vendored copy to an SDK
  tag keeps this explicit, and contract tests catch drift against recorded responses.
- Bundle cost is about 94 KB minified for the transport and the three services.
- Retries, deadlines and backoff (Stage 2) are implemented in our client, not inherited from the SDK.
  `topk-rs/src/client/retry.rs` is the reference for which codes to retry.

## Rejected

- **Bundle `topk-js`:** native addon, cannot ship.
- **`requestUrl`:** HTTP/1.1 only, rejected by TopK with 464.
- **`@grpc/grpc-js`:** works over `http2` too, but adds about 300 KB and a second protobuf stack
  (`protobufjs`, which uses `new Function` in reflection mode). Our unary-only needs are about
  150 lines.
- **Fetch / Chromium HTTP/2 from the renderer:** cannot set `te: trailers` or read gRPC trailers.
