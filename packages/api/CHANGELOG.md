# @amritk/api

## 0.1.0

### Minor Changes

- 4015b4d: Ship the adoption-readiness feature set, in both the runtime and compiled engines:

  - **Raw request bodies**: `ApiRequest.readText` / `readBytes` for webhook HMAC verification and uploads; the pipeline only consumes the body stream when a body schema is declared.
  - **Body size cap**: `maxBodyBytes` on `toFetchHandler` / `toNodeHandler` / `compileToModule` answers 413 via a shared capped stream reader (`readBytesCapped`), enforced for pipeline and handler-initiated reads alike.
  - **Streaming replies**: response contracts may declare `contentType`; handlers then return `ReadableStream` / `Uint8Array` / string bodies that adapters send untouched. `ApiRequest.signal` aborts on client disconnect.
  - **Hook chains**: `toFetchHandler({ onRequest, onResponse })` — short-circuiting gates before mounts/routing and decorators on every outgoing response; compiled via `onRequestExports` / `onResponseExports`.
  - **CORS**: `createCors(options)` returns an onRequest/onResponse hook pair handling preflight and response decoration.
  - **Custom error envelopes**: `createApi({ errors })` formatters for notFound / invalidJson / payloadTooLarge / validationFailed; compiled via `errorsExport`.
  - **Header schemas**: `request.headers` validates declared headers (with coercion) and emits `in: 'header'` OpenAPI parameters.
  - **Typed client**: the OpenAPI output is covered by a Hey API (`@hey-api/openapi-ts`) integration test generating a typed fetch SDK.
  - **Error reporting**: `onError` receives `(error, request, { route, env, executionContext })` in both engines (`onErrorExport` compiled), and `createSentry({ capture })` packages it for any Sentry-compatible client with zero added dependencies.
  - **Query fast path**: plain query strings parse in one pass without `URLSearchParams` (`buildQueryObjectFromString`, `ApiRequest.queryString`), with an exact fallback for encoded input — ~46% more throughput on query-validated routes.
  - **Docs**: the package README now covers the full surface with Drizzle / Better Auth / Sentry / Hey API integration recipes.
  - **405 Method Not Allowed**: a known path under the wrong method answers 405 with a sorted `allow` header instead of 404, in both engines; reshape it with `errors.methodNotAllowed`.
  - **Cookie schemas**: `request.cookies` validates declared cookies (RFC 6265 unquoting, percent-decoding, coercion, `source: 'cookies'` failures) and emits `in: 'cookie'` OpenAPI parameters.

- 4601f84: New package: contract-first, framework-agnostic API layer. Declare routes once (method, path, JSON Schemas, handler) and get typed handlers via `FromSchema`, guard-first request/response validation through `@amritk/runtime-validators` (pluggable for generated validators), OpenAPI 3.1 generation and serving with no extra code, and adapters for fetch-based frameworks (Hono, Next.js, Bun, Workers, Deno) and Node (Express, Fastify, node:http). Includes `compileToModule`, a build-time compiler that emits a fused, eval-free fetch-handler module from the same contracts — inlined guards, schema-derived serializers, precomputed OpenAPI — held observationally identical to the runtime engine by a differential test and measured faster than Hono on Cloudflare-Workers-style V8 workloads.

### Patch Changes

- Updated dependencies [797a156]
  - @amritk/runtime-validators@0.7.1
