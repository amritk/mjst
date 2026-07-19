# @amritk/api

## 0.3.0

### Minor Changes

- 1c49328: Add a family of `…Of` type helpers so apps can name their wire types straight from contracts instead of casting inline or hand-writing mirrors that drift: `ResponseBodyOf` (one declared status's schema-typed body — `type DemoLimitBody = ResponseBodyOf<typeof demoChat, 402>`), `SuccessBodyOf` / `ErrorBodyOf` (the generated-SDK-style data and error unions, split 2xx vs 4xx/5xx), `ResponseStatusOf` / `SuccessStatusOf` / `ErrorStatusOf` (the declared status domains), `RequestParamsOf` / `RequestQueryOf` / `RequestBodyOf` / `RequestHeadersOf` / `RequestCookiesOf` (the request slots, `undefined` when undeclared, mirroring what handlers see), and `ClientReplyOf` / `RouteReplyOf` (the client and handler reply unions keyed by the contract, like `ClientInput`). `ResponseBodyOf` derives from the declared schema, so a raw `contentType` status that documents a `body` schema still yields that type for callers who parse the stream themselves.
- e3f493f: Six capabilities driven by porting a production Cloudflare Worker (streaming AI chat, per-tenant auth, KV-backed rate limiting) from Hono — each implemented in both the runtime and compiled engines, held identical by the differential corpus, and eval-free for Workers:

  - **Contract/handler split + derived typed client**: `defineContract` declares a route contract as pure data (browser-safe import, no server code), `implementRoute(contract, handler)` binds the server implementation (`routeImplementer<AppContext>()` for context-typed handlers), and the one-shot `defineRoute` keeps working — every route _is_ a contract. `createClient(contracts, baseUrl, { fetch?, headers? })` derives a typed fetch client from the same contract literals with **no codegen** — the framework-agnostic replacement for Hono's `hc`: per-route calls with schema-typed `params`/`query`/`body`/`headers`/`cookies`, per-call `AbortSignal` and extra headers, injectable `fetch` for tests, and client-level static or (async) function headers for auth tokens. JSON statuses resolve to a `{ status, body, response }` union discriminated on `status`; `contentType` (raw/streaming) statuses expose the untouched `Response` for stream and header access; undeclared statuses throw a recognizable error (`isUnexpectedStatusError`) carrying the unread `Response`.
  - **Platform request escape hatch**: `ApiRequest.raw` carries each adapter's native request — the Web `Request` on the fetch adapter and compiled engine (Workers `request.cf` geo/ASN data), the `IncomingMessage` on Node. Typed `unknown` because reading it is platform-specific by design.
  - **Per-request `locals` bag**: one shared `Record<string, unknown>` per request flows through `onRequest` gates (fourth argument), `onResponse` decorators (third), the context factory (`input.locals`), handlers (`request.locals`), and error formatters/`onError` — an auth gate resolves a tenant once and everyone downstream reads it; a rate-limit gate's counters get stamped onto the response. Created lazily when no hooks are configured, so the untouched path stays allocation-free.
  - **Multiple `set-cookie` headers**: reply headers accept `string | string[]` per name (`ApiResponse`, handler replies, error formatters). Arrays serialize as separate header lines in both adapters and compiled modules via the shared `buildResponseHeaders` helper — never comma-folded, per RFC 6265 — unblocking better-auth session + CSRF and Stripe flows. The Node adapter validates each element before `writeHead`.
  - **Post-validation refinement**: an optional per-route `refine(validated)` hook for cross-field constraints JSON Schema cannot express ("sum of all message lengths ≤ 64k"). Runs after every slot validated, before the context factory and handler; returned issues reject through the standard `validation_failed` envelope (and `validationFailed` formatter) with custom `path`/`message`; a thrown refine takes the `onError` path.
  - **Unmatched-request observability**: `observeUnmatched` (compiled: `observeUnmatchedExport`) is called once per 404/405 with `route: undefined` — request-logging parity with framework middleware without wrapping the adapter. Kept separate from `observe` so its `route` stays non-optional.

  Breaking (pre-1.0 minor): `FetchOnRequest`/`FetchOnResponse` gained the trailing `locals` parameter and their `env`/`executionContext` parameters are now typed `unknown` instead of optional — hook _implementations_ are unaffected; only code invoking hook values directly must pass the extra arguments.

## 0.2.0

### Minor Changes

- 7c8fa86: Seven new capabilities, each implemented in both the runtime and compiled engines and held identical by the differential corpus:

  - **Form and multipart bodies**: `request.bodyType: 'form' | 'multipart'` parses `application/x-www-form-urlencoded` (query-style coercion: typed keys coerce, array keys accumulate) and `multipart/form-data` (string parts coerce, file parts reach the handler as `File` objects — declare them without a `type` keyword) against the declared body schema. Multipart parsing rides the platform's `Response#formData` over the shared buffered read, so `maxBodyBytes` still caps uploads. Parse failures answer `400 { error: 'invalid_body' }` (new `errors.invalidBody` formatter).
  - **415 enforcement**: a request whose `content-type` contradicts the declared body type answers `415 { error: 'unsupported_media_type' }` (new `errors.unsupportedMediaType` formatter) before any read. An absent content-type still falls through to the parse, so bare `curl` keeps working; JSON accepts `+json` structured suffixes.
  - **Greedy catch-all path parameters**: `/files/{path+}` (the AWS API Gateway convention) captures one or more remaining segments, decoded per segment and joined with `/`. Must be last; the bare prefix stays 404.
  - **OpenAPI components**: schemas carrying a `title` and reused across body positions hoist into `components.schemas` with `$ref` references — one `User` component and one generated client type instead of N inline copies. Conflicting titles stay inline.
  - **OpenAPI security, servers, deprecated**: `createApi`/`compileToModule` accept `servers`, `securitySchemes`, and a document-level default `security`; routes accept per-operation `security` and `deprecated`.
  - **Response header documentation**: `responses[status].headers` declares header schemas — emitted as OpenAPI header objects and validated (as an open object) under `validateResponses`, failing to the `invalid_response` 500 with `source: 'headers'`.
  - **`observe` hook**: called once per matched request with `{ route, request, status, durationMs, env, executionContext }` — per-route latency metrics and structured request logs with the route _pattern_ as the grouping key. Validation failures and handler errors are observed; 404s/405s and the OpenAPI document are not; a throwing observer is swallowed; unset costs nothing. Compiled via `observeExport`.

- 4e23c02: Production-readiness pass over both engines and both adapters:

  - **HEAD support (RFC 9110)**: `HEAD` is served automatically wherever `GET` is — the GET pipeline runs (validation, handler, response headers) and the adapters discard the body, cancelling streams rather than leaking them. Explicit `head` routes override the fallback. `405` allow lists advertise `HEAD` whenever `GET` appears, `matches()` claims HEAD for Express-style fallthrough, and the OpenAPI path answers HEAD too. Implemented identically in the runtime and compiled engines (held by the differential corpus).
  - **Shared buffered body reads**: `readBody`/`readText`/`readBytes` now share one buffered read in both adapters and in compiled modules, so handlers can read the body repeatedly and alongside a declared body schema (webhook HMAC plus parsed access). Previously a second read hung forever on Node and threw on fetch runtimes.
  - **Adapter failure boundary**: a reply that cannot be serialized (circular body, invalid header name/value) now answers the pipeline's own `500 { error: 'internal_error' }` instead of escaping as an unhandled rejection — in `toFetchHandler`, `toNodeHandler` (which pre-validates handler headers, since a mid-write `writeHead` failure leaves Node's response unrecoverable), and compiled modules.
  - **Query hardening**: query objects are built with a null prototype, so keys like `__proto__` land as ordinary own properties for the schema to judge instead of being silently dropped by the prototype setter.
  - **Node adapter**: JSON replies carry `content-length` instead of chunked transfer encoding.
  - **Packaging**: `sideEffects: false` and `engines.node >= 20` declared; README documents the requirements, the pre-1.0 stability policy, and the fetch/Node adapter feature split.

### Patch Changes

- Updated dependencies [4e23c02]
  - @amritk/runtime-validators@0.7.2

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
