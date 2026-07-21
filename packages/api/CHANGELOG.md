# @amritk/api

## 0.6.0

### Minor Changes

- d82bae9: Close a batch of capability gaps found migrating a real admin dashboard onto
  `@amritk/api` and `@amritk/mini`, all backward-compatible.

  **`@amritk/api`**

  - **All-optional query (and cookie) slots are optional at the call site.** When
    every property of a declared `query`/`cookies` schema is optional (no
    `required`), the slot — and, when it is the only declared slot, the whole
    input argument — is now optional in `ClientInput`, folded into `RequiredKeys`
    the same way a fully-absent slot already is. A GET whose query params are all
    optional type-checks as `client.listThings()`. `params` (the path needs them)
    and `body` (declaring it makes a body required) stay strictly required.
  - **Raw `text` / `bytes` request bodies.** `bodyType` gains `'text'` and
    `'bytes'`: the body is validated verbatim against the schema and handed to the
    handler as a `string` (decoded) or a `Uint8Array`, and the typed client sends
    the call's `body` on the wire unchanged under a raw content type you can
    override per call via `headers` — a `text/csv` or binary upload that stays
    inside the typed contract and client. Both engines and the OpenAPI document
    understand it; the 415 check is lenient (`text/*` for text, any media type for
    bytes) so the schema is the gate.
  - **`mounts` handlers receive `env` and `executionContext`.** Prefix-mounted
    sub-handlers (`toFetchHandler` and the compiled engine) are now called with
    the platform arguments as well as the `Request`, so an env-dependent
    sub-router — Better Auth on Cloudflare Workers, where secrets and the DB URL
    live on `env` — can build its instance inside the mount. Existing
    `(request) => Response` mounts keep working.

  **`@amritk/mini`**

  - **`bindSelect(node, model)`** — two-way binding between a `<select>` and a
    string signal, the dropdown analogue of `bindValue`/`bindChecked`: it sets
    `.value` (the property, so the option actually selects) and writes back on
    `change`.
  - **More typed form-control attributes.** `<input>` gains `name`, `checked`,
    `accept`, `min`, `max`, `step`, `multiple`, and `readonly`; `<textarea>` gains
    `name`, `required`, and `readonly` — so file, number, and checkbox inputs stop
    needing `ref` + `setAttribute`.

## 0.5.0

### Minor Changes

- da1be72: Compiled-engine parity and deployment features: `hashContracts` plus a baked `contractsHash` with an init-time staleness warning in every module `compileToModule` emits (schema edits without regeneration now surface as a `console.error` instead of silent drift); `compileExport` on `CompileModuleOptions` so a custom `ValidatorCompiler` (the runtime `compile` option) drives every guard and collector in the compiled engine too; `validateResponses` on `CompileModuleOptions` for runtime-identical reply body/header validation (`invalid_response` 500s) in the compiled engine; and `fetchToNodeHandler`, a general Node bridge that runs any fetch handler — a compiled module's `fetch` export included — under `node:http`/Express with streaming, repeated `set-cookie`, backpressure, and disconnect handling.
- 5395bed: Add more framework-parity helpers, all composing through existing seams
  (`mounts`, `onRequest`/`onResponse`, the raw response, the context factory) —
  no request-pipeline changes:

  - `createCsrf` — stateless double-submit CSRF protection.
  - `createHealth` — a health/readiness endpoint (`200`/`503`) running probes
    concurrently, for load balancers and Kubernetes gates.
  - `signCookie`/`unsignCookie`/`createSignedCookies` — HMAC-SHA256 signed
    cookies over Web Crypto (no dependency).
  - `sseStream`/`formatSse` — Server-Sent Events as a streaming body for
    raw-`contentType` routes.
  - `negotiateMediaType`/`parseAccept` — server-driven content negotiation with
    RFC 9110 media-range specificity and `q=0` handling.
  - `versionRoutes` — URI-prefix API versioning (`/v1`, `/v2`).
  - `withTimeout` — a per-handler wall-clock deadline.
  - `runAfterResponse`/`createBackground` — after-response ("background") work
    via `waitUntil` where the platform provides it.

- 09ff86c: Add framework-parity middleware helpers, each composing through the existing
  `onRequest`/`onResponse`/`mounts` seams (no core pipeline changes):

  - `createRateLimit` — request rate limiting with `RateLimit-*`/`Retry-After`
    headers, a 429 short-circuit, and a pluggable store (in-memory default).
  - `createRequestId` — correlation-id propagation into `locals` and the
    response, with `getRequestId`.
  - `createSecurityHeaders` — the `helmet`/`secure-headers` baseline as an
    `onResponse` decorator.
  - `createCompression` — gzip/deflate response compression over the platform
    `CompressionStream`.
  - `createETag` — automatic entity tags and conditional-GET (`304`) handling.
  - `createDocs` — an interactive API reference page (Scalar/Swagger UI/ReDoc)
    served next to `openapi.json`, with `docsHtml`.

- da1be72: Deep-review hardening pass across the client, OpenAPI projection, request pipeline, and bundler plugins.

  **Breaking (pre-1.0 minor): request bodies are now capped at 1 MiB by default.** `maxBodyBytes` keeps its meaning on both adapters and `compileToModule`; unset now means 1 MiB instead of unbounded (a memory-exhaustion vector), and `maxBodyBytes: Infinity` restores unbounded reads.

  **Typed client.** `fetchOptions` (client-level and per-call `RequestInit` extras — `credentials`, `cache`, `redirect`, …) and `timeoutMs` (composes with a per-call `signal` via `AbortSignal.any`). Requests send `accept: application/json` by default. A declared JSON status whose body fails to parse throws `malformedBodyError` — recognizable via `isMalformedBodyError`, carrying the `Response` and the parse error as `cause` — instead of a bare `SyntaxError`. Documented: the `cookies` slot cannot work from browsers (forbidden header); use server-set cookies plus `fetchOptions: { credentials: 'include' }`.

  **OpenAPI.** Greedy `{name+}` routes now emit valid documents (`{name}` templates with a matching, described parameter). Schemas carrying internal `$ref`s hoist into `components.schemas` with refs re-rooted, so recursive shapes resolve. Every operation gets a deterministic `operationId` (explicit wins; duplicates throw at startup). `info` accepts `contact`/`license`/`termsOfService`, documents accept top-level `tags` objects (plumbed through `createApi` and `compileToModule`), and multipart file parts get `encoding` entries. The served document carries a strong `etag` + `cache-control: no-cache`, answers `304` to `if-none-match`, and is serialized once per process.

  **HTTP semantics (both engines, differential-pinned).** `OPTIONS` on a known path answers `204` with a sorted `allow` header (explicit `options` routes still win), and 405 `allow` lists advertise `OPTIONS`. `refine` may be async — a returned promise is awaited, rejections take the `onError` path.

  **Node adapter.** Streaming replies honor `write()` backpressure with a hang-proof `drain` wait, so fast producers no longer buffer unbounded memory against slow clients.

  **CORS.** `createCors` throws at setup on the browser-rejected `origin: '*'` + `credentials: true` combination.

  **Bundler.** New `stripContractsEsbuild` and `stripContractsRollup` join the Vite and Bun plugins, and the strip transform is now line-preserving so `map: null` no longer misaligns downstream sourcemaps.

  The cap keeps the native read path: a body whose declared `content-length` fits the limit reads via `arrayBuffer()` (with a post-read length check), and only chunked or unparseable-length requests take the streaming capped reader — so on realistic traffic the default cap costs ~4%, not the 82% an always-streaming read would.

- ca672c3: Add `streamMultipart` (and `multipartBoundary`) — a streaming
  `multipart/form-data` parser for large file uploads. Where the pipeline's
  built-in multipart handling buffers the whole body via `Response.formData`,
  this yields each part with its bytes streamed, so a multi-gigabyte upload flows
  through at constant memory. Reach it from a handler through `request.raw`.
  Purely additive — the existing buffered path is unchanged.

### Patch Changes

- 824b869: Map the host framework's body-limit error to a 413. When the API is mounted on
  another server (Fastify's content-type parser at its `bodyLimit`, Express's
  `body-parser`/`raw-body`, or any HTTP error carrying a 413 status), an
  oversized body now takes the `payloadTooLarge` path instead of the generic
  `onError`/500 — fixing e.g. a 20 MiB body returning `500` rather than `413`.
  Recognition is shared by the interpreted and compiled engines.

## 0.4.0

### Minor Changes

- aabd4c4: Slim browser bundles for `createClient` — a contract-slimming bundler plugin plus opt-in wire formats.

  **New: `@amritk/api/bundler`.** `stripContractsVite()` (Vite) and `stripContractsBun()` (`Bun.build`) strip server/OpenAPI freight — request/response schemas, `refine`, `summary`, `description`, tags, security — from `defineContract` call sites in browser builds, keeping only what the client runtime reads (`method`, `path`, `bodyType`, body/`contentType` markers). Types are compile-time, so consumers see no difference; unparseable call sites are left untouched. Measured on a three-contract JSON-only widget: contract data drops from 1.3 kB to 0.31 kB minified (~75% per route), the full bundle from 3.6 kB to 2.7 kB minified (1.7 kB to 1.4 kB gzip).

  **Breaking: form/multipart serialization is now opt-in.** `bodyType: 'form'` / `'multipart'` contracts need their serializer registered: `createClient(contracts, url, { serializers: [formBodySerializer, multipartBodySerializer] })`. JSON stays built in (and can be overridden with a custom `bodyType: 'json'` serializer). Calling a contract whose `bodyType` has no registered serializer throws with the fix in the message.

  **Breaking: `{param}` path building is now opt-in.** Contracts with path parameters need `createClient(contracts, url, { pathParams: buildParamPath })`. Static-path apps pass nothing and no longer bundle the template code.

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/runtime-validators@0.7.3

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
