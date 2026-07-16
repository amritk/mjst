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
| bare async handler (baseline) | ~7.5M ops/s |
| static route, no validation | ~1.5M ops/s |
| post route + body validation | ~0.8M ops/s |
| dynamic route + params/query validation | ~0.3M ops/s |

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
subjects eval-free and Workers-deployable as benchmarked
(`bench-workers` scratch, 2026-07):

| case | hono (no validation) | hono + zod | @amritk/api today | + generated validators | compiled prototype |
|:--|--:|--:|--:|--:|--:|
| static GET | ~254k | ~253k | ~208k | ~217k | **~346k** |
| dynamic GET, params validated | ~221k ¹ | ~177k | ~180k | ~190k | **~317k** |
| POST, body validated | ~61k ¹ | ~51k | ~60k | ~62k | **~73k** |

<sub>¹ hono-bare rows do no validation at all; every @amritk/api row validates.</sub>

Today's package already matches or beats the real-world Hono+zod stack on
validated routes. The compiled prototype — hand-written in the exact shape a
build step would emit — beats even unvalidated Hono by 30–45% everywhere,
*with validation on*.

### What `mjst compile` would emit

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

## Roadmap / open questions

- **Generated-validator integration sugar.** A `mjst` CLI mode that reads
  route files and emits a ready-made `compile` function (schema-identity →
  generated validator), closing the loop with `@amritk/generate-validators`
  automatically.
- **Header/cookie schemas.** `request.headers` validation and the matching
  `in: 'header'` parameters.
- **Content negotiation.** Non-JSON bodies (multipart, text, streams) and
  per-status content types.
- **`$ref` / components.** Shared schemas could be hoisted into
  `components.schemas` (via `@amritk/resolve-refs` knowledge of the ref graph)
  instead of inlined per operation, shrinking large documents.
- **First-class Fastify plugin.** The Node handler works via raw req/res, but
  a plugin registering per-route would let Fastify's own router carry the
  matching.
- **Example generation.** `@amritk/generate-examples` can derive request/
  response examples for the OpenAPI document and fast-check arbitraries for
  contract fuzzing — same contract, two more outputs.
- **Route-level middleware/auth.** Deliberately excluded so far; the erased
  handler boundary is where a typed middleware chain would slot in.
