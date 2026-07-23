# Plan: API Framework (`@amritk/api`)

## Goal

A contract-first API layer on top of mjst's JSON Schema tooling that works
with any TypeScript HTTP framework — Hono, Next.js, Fastify, Express, Bun,
Cloudflare Workers — and delivers:

1. **OpenAPI generation with no extra code** — the route contract *is* the
   documentation source.
2. **Validation of input and response** using mjst validators.
3. **Performance as the top priority** — the framework tax per request should
   be routing + one guard call per declared slot, nothing more.

## Key insight

mjst already contains every hard piece; none of them knows about HTTP yet:

| Need | Existing mjst piece |
|:---|:---|
| Runtime validation of a schema declared in code | `@amritk/runtime-validators` — eval-free, zero startup cost |
| Zero-allocation happy path | `validateGuard` (boolean guard) + `validate` (error collector) split |
| Handler typing from a schema literal | `FromSchema` (type-level mirror of the interpreter) |
| Maximum steady-state throughput | `@amritk/generate-validators` build-time codegen |
| Schemas authored in Zod/TypeBox/Valibot/Effect | `@amritk/adapters` |
| OpenAPI documents | **free**: OpenAPI 3.1's schema dialect *is* JSON Schema Draft 2020-12, so contract schemas embed verbatim |

So the framework is a thin composition layer: a route contract type, a
startup compiler, a request pipeline, an OpenAPI projector, and per-framework
adapters. It is deliberately *not* a server — `handle(ApiRequest) →
ApiResponse` is the whole runtime, and frameworks wrap it.

## Architecture

```
defineRoute()                 identity fn; const type params capture schema
     │                        literals → handler typed via FromSchema
     ▼
createApi()                   startup compilation (once):
     │                          ├─ parsePathPattern()    /users/{id} → segments
     │                          ├─ ValidatorCompiler     guard + collector per schema
     │                          ├─ buildCoercionPlan()   string→number/boolean/array plan
     │                          └─ route tables          static Map + per-method dynamic list
     ▼
api.handle(ApiRequest)        per request:
     │                          ├─ matchRoute()          O(1) static hit, else segment scan
     │                          ├─ coerce + guard        params, query, body (all lazy/optional)
     │                          ├─ handler(context)      typed, pre-validated values
     │                          └─ optional response validation (dev/test)
     ▼
ApiResponse ──► adapters      toFetchHandler (Hono, Next.js, Bun, Workers, Deno)
                              toNodeHandler  (node:http, Express/Connect, Fastify raw)
```

### The contract

```ts
const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',                    // OpenAPI syntax — maps into the doc verbatim
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  responses: {
    200: { body: userSchema },
    404: {},
  },
  handler: ({ params }) =>                // params.id: number — validated AND coerced
    params.id === 1 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 },
})
```

Two type-level decisions worth recording:

- **Schema slots are `unknown`, not `JSONSchema`.** A `JSONSchema` constraint
  would force `const`-inferred literals (`required: ['id']` as a readonly
  tuple) to widen and break `FromSchema`. This mirrors how
  `runtime-validators`' own `validate<const S = unknown>` is typed.
- **Erasure via `never` context.** `createApi` takes `AnyRouteContract[]`;
  typed handlers are assignable to it because the erased context's slots are
  `never` (functions are contravariant in parameters). The pipeline casts once,
  after validation has proven the values match the schemas.

## Performance strategy

- **Everything derivable is derived at startup.** Validators are prepared,
  coercion plans computed, and paths parsed exactly once per route. The
  request path never inspects a schema.
- **Guard-first validation.** The happy path runs only `validateGuard`'s
  boolean guard — short-circuiting, zero allocation. The error-collecting
  validator runs *only after* a guard has rejected, so valid traffic does no
  error bookkeeping.
- **Two-tier router.** Fully-static paths live in a flat
  `Map<'METHOD /path', route>` (one concat + one get). Only parameterized
  routes pay a per-segment scan, after a single `split('/')`.
- **Lazy transport parsing.** `ApiRequest.searchParams` and `readBody` are
  thunks; a route that declares no query/body schema never parses them. The
  Node adapter splits the query string with `indexOf` and never touches the
  body stream unless asked.
- **Coercion plans, not schema walks.** HTTP delivers all params as strings.
  Declared `number`/`integer`/`boolean`/`array` properties get a
  `Map<key, kind>` computed at startup; per request it is one map lookup per
  key. Unparseable values stay strings so the validator reports honest type
  errors (`Number('abc')` → NaN would otherwise `typeof`-check as a number).
- **Shared frozen constants** for no-vary responses (404, 500, invalid JSON)
  and empty params — the miss path allocates nothing either.
- **Pluggable engine ceiling.** The `compile` hook accepts any
  `(schema) → { guard, collect }`, so hot routes can swap the interpreter for
  `@amritk/generate-validators` output (~48M ops/s on small shapes vs the
  interpreter's ~2M) with no pipeline changes. Response validation is off by
  default in production; when on, it reuses the same guard-first structure.

Measured overhead (Bun, `packages/api/bench/run.ts`, interpreter engine):

| case | throughput |
|:--|--:|
| bare async handler (baseline) | ~7.3M ops/s |
| static route, no validation | ~1.6M ops/s |
| post route + body validation | ~1.0M ops/s |
| dynamic route + params/query validation | ~0.34M ops/s |

The dynamic case pays for `URLSearchParams` construction plus two validations;
swapping in generated validators moves it substantially, and both numbers sit
far above what a single Node/Bun process serves in practice.

## OpenAPI generation

`toOpenApi(routes, info)` projects contracts into a 3.1 document:

- `path` strings are already OpenAPI templates — no rewriting.
- `params` / `query` object schemas unroll into per-property Parameter
  Objects; path parameters are forced `required: true` per spec.
- `request.body` becomes `requestBody` with `application/json` content.
- Each response gets its spec-mandated `description` (defaulted when omitted)
  and its schema embedded verbatim.
- The document is built lazily, cached, and served at `GET /openapi.json` by
  default (`openApiPath` to move or disable).

Because the same schema object validates requests and appears in the document,
docs and behavior cannot drift.

## What shipped in the first cut (`packages/api`)

Route contracts + `defineRoute` typing, startup compiler, two-tier router,
coercion plans, guard-first pipeline, response validation (opt-in), OpenAPI
3.1 projection + serving, `toFetchHandler`, `toNodeHandler` (with Express
`next()` fall-through), `compile` hook, `onError` hook, bench harness, 80
tests including type-level assertions.

## Cloudflare Workers: the strategic target

Workers ban `new Function`/`eval`, which disarms every runtime-compilation
trick the fast frameworks rely on: Elysia must run with AOT off, Ajv cannot
compile, TypeBox's `TypeCompiler` is unavailable. The practical incumbent is
Hono (usually with zod validation). mjst's **build-time** codegen is the one
way to get compiled-validator speed on a platform where runtime compilation is
illegal — nothing about the platform constrains what a build step may emit.

Measured on V8/Node (same engine as workerd), pure `Request → Response`, all
subjects eval-free and Workers-deployable as benchmarked (one session, same
machine, 2026-07, after the runtime performance pass):

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~339k | ~361k | ~392k | **~530k** |
| dynamic GET, params validated | ~311k ¹ | ~209k | ~302k | **~381k** |
| POST, body validated | ~74k ¹ | ~63k | ~74k | **~82k** |

<sub>¹ hono-bare rows do no validation at all; every @amritk/api row validates.</sub>

The runtime (development) engine sits at or above unvalidated Hono while
validating; the compiled engine leads every case by 22–57%. The single
biggest runtime-engine win was response construction: replacing
`Response.json` with `new Response(JSON.stringify(...), cachedInit)` (one
`ResponseInit` per status, reused) measured ~40% through the whole pipeline —
`Response.json` builds a Headers object per call. A nested-map router variant
was measured and *rejected* (the `method + ' ' + path` concat key is faster
than two map hops).

Honest counterpoint: under Bun/JSC, Elysia's AOT still dominates static
routes (~1.4M ops/s to our ~423k) — that is its home turf and it caches
static responses. We still win validated POSTs there. The Workers claim is
the strategic one because that is where Elysia's compiler is banned.

### Shipped: `compileToModule`

The compiled engine described below now exists as
`compileToModule(options): string` (`packages/api/src/compile/`). It emits the
fused module from route contract *values* — no AST work, no TS checker — and a
differential test (`compile-to-module.test.ts`) holds the compiled and runtime
engines observationally identical across a corpus covering valid/invalid
inputs, coercion, encoded segments, trailing slashes, thrown handlers, custom
headers, empty replies, and the OpenAPI document. Guards and serializers only
inline for the schema subset they can reproduce exactly, and fall back to the
interpreter otherwise, so semantics never fork. The guard subset covers
explicit primitive/object/array types, string lengths (counted in code
points, like the interpreter), `pattern` (Unicode-first compile), numeric
bounds, primitive `enum`/`const`, OpenAPI `nullable: true`,
`additionalProperties: false`, `required`, and nested objects/arrays of the
same subset; serializers additionally require `additionalProperties: false`.
Anything else — `multipleOf`, `uniqueItems`, combinators, `$ref`,
prototype-member property names — bails to the interpreter.

Current numbers live in the table above (§ Cloudflare Workers). The intended
workflow is runtime engine in development, compiled module in production,
switched by an import — the differential test is what makes that swap safe.

### What the compiled module contains

One monomorphic module per route, all plain TypeScript source (tree-shakeable,
no eval, small bundle → faster cold start):

- **Fused adapter** — no intermediate `ApiRequest` object or per-request
  closures; the pathname is sliced from `request.url` by hand (a `new URL()`
  parse benchmarked at ~a fifth of adapter cost and is now avoided in
  `toFetchHandler` too).
- **Inlined validation** — `@amritk/generate-validators` output pasted into
  the route body; param coercion unrolled per key from the coercion plan.
- **Schema-derived serializers** — fast-json-stringify-style string building
  from the response schemas (`'{"id":' + body.id + …`), with `JSON.stringify`
  only where escaping matters. Needs a new `@amritk/generate-serializers`
  generator; user handlers are wrapped, never rewritten.
- **Static router** — the method/path dispatch emitted as a plain `if`/switch
  over string compares, shared `ResponseInit` constants.
- **Precomputed OpenAPI** — the document serialized to a static JSON string at
  build time, served with zero per-request work.

The runtime package stays the no-build-step path (and the fallback for routes
the compile step cannot see); `mjst compile` becomes the opt-in ceiling. Same
contract, three engines: interpreter → generated validators → fully compiled
routes.

## Shipped: the agent-ummo readiness set (2026-07)

The gaps identified in `docs/ummo-readiness.md` are closed, in both engines
(every feature below is exercised by the differential test):

- **Raw request bodies + size cap.** `ApiRequest.readText` / `readBytes` read
  the body exactly as it arrived (webhook HMAC verification, CSV uploads);
  the pipeline never consumes the stream unless a body schema is declared.
  `maxBodyBytes` (adapter option / compile option) rejects oversized bodies
  with a 413 via a shared capped reader — checked against `content-length`
  up front and enforced while the body streams, including handler-initiated
  reads.
- **Streaming / raw replies + abort signal.** A response contract may declare
  `contentType`; the handler then returns a `ReadableStream`, `Uint8Array`,
  or string that adapters send untouched (the agent-chat token stream shape).
  `ApiRequest.signal` aborts on client disconnect.
- **Hook chains + CORS.** `toFetchHandler({ onRequest, onResponse })`: gates
  run before mounts and routing (first `Response` short-circuits), decorators
  run on every outgoing response — including 404s, gate replies, and mounted
  routers — which is where security headers, rate limits, and feature flags
  live. `createCors(options)` returns such a hook pair (preflight +
  decoration). Compiled equivalents: `onRequestExports` /
  `onResponseExports`.
- **Custom error envelopes.** `createApi({ errors })` formatters for
  `notFound` / `invalidJson` / `payloadTooLarge` / `validationFailed`, so an
  app migrating onto the framework keeps its wire-visible error shape.
  Compiled equivalent: `errorsExport`.
- **Header schemas.** `request.headers` validates like params/query (declared
  names only, string coercion, `source: 'headers'` failures) and unrolls into
  `in: 'header'` OpenAPI parameters.
- **Typed client via Hey API.** The OpenAPI document is verified as
  [openapi-ts](https://heyapi.dev) input: `hey-api-client.test.ts` generates
  a fetch SDK from `toOpenApi` output and asserts the contract's types come
  through (typed path params, required headers, per-status responses). This
  replaces framework-coupled RPC clients (Hono's `hc`) — the client is
  generated from the same schemas that validate requests.

## Shipped: release hardening (2026-07, second pass)

- **Error reporting seam.** `onError` now receives
  `(error, request, { route, env, executionContext })` in both engines
  (`onErrorExport` in the compiled module) — the route *pattern* for issue
  grouping plus the platform values Workers Sentry clients need.
  `createSentry({ capture })` packages it with zero dependencies (structural
  typing fits `@sentry/node`, `@sentry/cloudflare`, Toucan); a throwing
  capture is swallowed, validation failures are not reported.
- **Query fast path.** `buildQueryObjectFromString` parses plain query
  strings in one pass and falls back to `URLSearchParams` for anything
  percent-encoded (parity held by comparison tests against the real thing).
  Both adapters expose the raw string (`ApiRequest.queryString`) and the
  compiled module calls it directly. Measured on Bun: the dynamic
  params+query case went **~355k → ~519k ops/s (+46%)**; other cases
  unchanged.
- **README.** `packages/api/README.md` now covers the full surface with
  integration recipes (Drizzle, Better Auth, Sentry, Hey API) — the
  integration philosophy is *recipes over plugins*: the core keeps its single
  dependency and third parties connect through `context`/`mounts`/hooks/
  `onError` seams rather than bundled SDKs.
- **405 Method Not Allowed.** A known path under the wrong method now answers
  405 with a sorted `allow` header (both engines; `errors.methodNotAllowed`
  reshapes it). The compiled dispatch grew a shared 405/404 tail: static
  paths answer from a build-time path→methods map, parameterized paths from
  re-emitted segment checks.
- **Cookie schemas.** `request.cookies` validates like headers — declared
  names only (browser tracking noise never reaches validation), RFC 6265
  unquoting + percent-decoding, string coercion, `source: 'cookies'`
  failures, `in: 'cookie'` OpenAPI parameters — via a shared
  `buildCookiesObject` both engines import.

## Shipped: deep-review hardening pass (2026-07, third pass)

A full-surface review (four parallel audits: pipeline, client, compiled
engine, OpenAPI/adapters) closed these in one pass — every behavioral change
in both engines, pinned by the differential corpus:

- **Safety defaults**: 1 MiB default `maxBodyBytes` (`Infinity` opts out);
  Node adapter streaming backpressure (`drain`-aware pump).
- **HTTP semantics**: automatic `OPTIONS` → 204 + `allow` (405s advertise
  `OPTIONS` too); async `refine`.
- **OpenAPI validity/completeness**: greedy `{name+}` template rewrite;
  internal-`$ref` schemas hoisted with refs re-rooted; deterministic
  `operationId` synthesis + duplicate detection; `info`
  contact/license/termsOfService; document-level `tags`; multipart
  `encoding` objects; etag + 304 serving of the document.
- **Client**: `fetchOptions` + `timeoutMs` (signal composition), Accept
  default, `malformedBodyError`, browser-cookie caveat documented.
- **Compiled engine**: `contractsHash` staleness warning, `compileExport`
  (custom-validator parity), `validateResponses` parity,
  `fetchToNodeHandler` bridge, and the `mjst compile-api` CLI subcommand.
- **Bundler**: esbuild + Rollup strip plugins; line-preserving transform.
- **CORS**: setup-time throw on `'*'` + credentials.

## Roadmap / open questions

- **Generated-validator integration sugar.** `mjst compile-api` now wraps
  `compileToModule`; the remaining sugar is a mode that also emits a
  ready-made `compile` function (schema-identity → generated validator),
  closing the loop with `@amritk/generate-validators` automatically
  (`compileExport` provides the seam).
- **Deferred from the review pass** (design-heavy, not fixes): client
  retry/interceptor chain and opt-in client-side validation; per-route body
  limits; base-path mounting of the API itself; `deepObject` query style;
  request charset decoding; a server-side handler timeout (a blanket
  timeout would kill legitimate long-lived SSE/token streams — needs a
  per-route design); webpack/Turbopack strip plugin (the exported
  `stripContractFields` covers it via a ~5-line loader); compiled-module
  source maps; watch mode for `compile-api`.
- **Content negotiation, inbound.** Raw *outbound* statuses shipped
  (`contentType` above); multipart/form-data request bodies remain manual
  via `readBytes`.
- **`$ref` / components.** Shared schemas could be hoisted into
  `components.schemas` (via `@amritk/resolve-refs` knowledge of the ref graph)
  instead of inlined per operation, shrinking large documents.
- **First-class Fastify plugin.** The Node handler works via raw req/res, but
  a plugin registering per-route would let Fastify's own router carry the
  matching.
- **Example generation.** `@amritk/generate-examples` can derive request/
  response examples for the OpenAPI document and fast-check arbitraries for
  contract fuzzing — same contract, two more outputs.
  Verified end to end against the real packages (2026-07): Better Auth
  (memory adapter) mounted at `/api/auth` issues a session via its own
  sign-up endpoint; the session flows through the app context; a
  contract-declared 401 guards `/profile`; and Drizzle (`bun:sqlite`) serves
  an owner-scoped query from the same context — with the 401 appearing in
  the generated OpenAPI document like any other response.

- ~~Route-level middleware/auth.~~ Superseded by shipped primitives that cover
  the real-world cases without a middleware chain: a **typed app context**
  (`createApi({ context })` + `routeFactory<Context>()`, receiving platform
  `env`/`executionContext` — Drizzle handles, Better Auth sessions), **prefix
  mounts** (`toFetchHandler(api, { mounts })` / `compileToModule({ mounts })` —
  Better Auth's own endpoints pass through as raw Request/Response), and
  **route guards** (see below). Auth *outcomes* stay contract-declared: a
  protected route declares its 401, so it documents itself.
- **Route guards.** `guards: [...]` on `defineRoute`/`implementRoute`/
  `routeImplementer` (server side — the browser-safe `defineContract` stays
  pure data) run in order after the context factory and before the handler,
  first denial winning; sync or async, a thrown guard takes the `onError`
  path. A guard is `(ctx) => reply | undefined`: it sees the same
  `RequestContext` the handler will (resolved session included) and denies with
  a reply or passes with `undefined`. The return type is tied to the contract's
  response map, so a guard can only deny with a *declared* status — enforcement
  that cannot silently open an endpoint, and the 401/403 is already in the
  OpenAPI document. `requireContext(predicate, deniedReply)` packages the
  reusable session/role check. Both engines run guards identically (the
  compiled module threads the live `contract.guards` through a shared
  `runGuards` in the same order); the differential corpus pins the parity,
  including an async guard and a throwing guard down `onError`. Guards are
  excluded from the contracts hash — like `handler` and `refine`, they are
  imported and called live. Guards attach in one place — the `guards` field —
  and the denial status stays *declared on the contract* rather than derived
  from the guard: the contract remains the single source of truth for the wire,
  so OpenAPI, response validation, and the typed `createClient` all agree with
  nothing to reconcile. (An earlier `protectedRoute` that merged a guard's
  declared responses onto the route was dropped: it added a second calling
  convention and could not keep the browser `createClient` in sync without a
  manual fragment spread, so it fought the contract-first grain for a marginal
  DRY win. Declaring a shared `authResponses` fragment covers the boilerplate.)
