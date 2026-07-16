# @amritk/api

Contract-first, framework-agnostic API layer built on mjst's JSON Schema
tooling. Declare each route once — method, path, request schemas, response
schemas, handler — and get typed handlers, fast request/response validation,
and an OpenAPI 3.1 document with **no extra code**. Thin adapters connect the
same API to Hono, Next.js, Bun, Cloudflare Workers, Deno (fetch), and
Express, Fastify, or raw `node:http` (Node).

- **One contract, everything derived.** The JSON Schemas in a route type the
  handler (via `FromSchema`), validate requests at runtime, and embed verbatim
  into the OpenAPI document — OpenAPI 3.1's schema dialect *is* JSON Schema
  Draft 2020-12, so there is no conversion layer to drift.
- **Fast by structure.** All schema work (validator preparation, coercion
  planning, path parsing) happens once at startup. Per request: an O(1) map hit
  for static paths, a boolean guard that short-circuits and never allocates on
  valid input, and error collection that only runs after a guard has already
  said no. Query strings and bodies are parsed lazily — routes that do not
  declare them never pay for them.
- **Typed end to end.** Handlers receive `params` / `query` / `body` already
  validated and coerced, typed from the schema literals. The return type is
  derived from the `responses` map — returning an undeclared status or a wrong
  body shape is a compile error.
- **Eval-free.** The default engine is `@amritk/runtime-validators` — no
  `new Function`, so it runs under strict CSP, Cloudflare Workers, and
  React Native. Swappable for generated validators when you want maximum
  steady-state throughput (see below).

## Usage

```ts
import { createApi, defineRoute, toFetchHandler } from '@amritk/api'

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  summary: 'Fetch a user',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
  },
  responses: {
    200: { body: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] } },
    404: {},
  },
  handler: ({ params, query }) => {
    // params.id is a number, query.verbose is boolean | undefined — already
    // validated, already coerced from their string transport form.
    return params.id === 1 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 }
  },
})

const api = createApi({
  routes: [getUser],
  info: { title: 'Users API', version: '1.0.0' },
})
```

`api.handle` is the whole runtime; `GET /openapi.json` serves the generated
document (configurable via `openApiPath`). Note: for the types to flow, write
schemas inline (as above) or declare shared ones `as const` — a plain `const`
widens the literal before `defineRoute` sees it.

### Serving it

```ts
// Bun / Cloudflare Workers / Deno — a Web-standard fetch handler
const handler = toFetchHandler(api)
Bun.serve({ fetch: handler })

// Hono
app.mount('/', handler)

// Next.js app router (app/[...route]/route.ts)
export const GET = handler
export const POST = handler

// node:http / Express / Connect
import { toNodeHandler } from '@amritk/api'
http.createServer(toNodeHandler(api)).listen(3000)
app.use(toNodeHandler(api)) // unmatched paths fall through to the rest of the app
```

Writing an adapter for anything else is ~15 lines: construct one
[`ApiRequest`](./src/types.ts) per incoming request and serialize the
`ApiResponse` that `api.handle` resolves with.

### Options (`createApi`)

| Option | Default | Description |
|:---|:---|:---|
| `routes` | — | The route contracts (from `defineRoute`). Duplicate `method + path` shapes throw at startup. |
| `info` | placeholder | OpenAPI `info` block (`title`, `version`, `description`). |
| `openApiPath` | `/openapi.json` | Where the document is served. `false` disables serving. |
| `compile` | runtime-validators | Swap the validation engine — see below. |
| `validateResponses` | `false` | Validate reply bodies against the declared response schemas; mismatches become a 500. A development/test net. |
| `onError` | bare 500 | Map a thrown handler error to a response. The default never leaks the error message. |

### Validation semantics

- Path and query parameters arrive as strings, so declared `number` /
  `integer` / `boolean` / `array` properties are coerced first (from a plan
  computed at startup — no per-request schema inspection). A value that does
  not parse stays a string and fails validation with a proper type error.
- Repeated query keys (`?tag=a&tag=b`) accumulate into arrays when the schema
  declares an array; undeclared keys pass through as strings so
  `additionalProperties` rules still apply.
- Declaring `request.body` makes a JSON body required; a body that fails to
  parse is a `400 { error: 'invalid_json' }`.
- Validation failures answer `400` with `{ error: 'validation_failed', source,
  errors }` where `errors` carries the same `{ message, path }` shape as
  `@amritk/runtime-validators`.

### Plugging in generated validators

The `compile` hook accepts any engine that can produce a boolean guard and an
error collector per schema. To trade startup codegen for maximum steady-state
throughput, generate validators with `@amritk/generate-validators` at build
time and route the hot schemas to them:

```ts
import { isUser, validateUser } from './generated/user'

const api = createApi({
  routes,
  compile: (schema) =>
    schema === userSchema
      ? { guard: isUser, collect: (input) => validateUser(input) }
      : { guard: validateGuard(schema), collect: validate(schema) },
})
```

### Production: the compiled engine

`compileToModule` is the production counterpart to `createApi` — it emits a
fused fetch-handler module from the same contracts: routing as string
compares, guards and coercions inlined from the schemas (interpreter fallback
outside the provably-identical subset), schema-derived response serializers
(for responses marked `additionalProperties: false`), and the OpenAPI
document precomputed to a static JSON string. The output is plain source — no
`eval`, no `new Function` — so it runs on Cloudflare Workers and under strict
CSP, where every runtime-compilation trick other frameworks use is banned.

The intended split: **runtime engine in development** (instant, no build step,
`validateResponses` available), **compiled module in production**. The two
engines are held observationally identical by a differential test that runs
the same request corpus through both, so switching is just an import swap.

```ts
// scripts/compile-api.ts — the build step
import { writeFileSync } from 'node:fs'
import { compileToModule } from '@amritk/api'
import * as routes from '../src/routes'

writeFileSync('src/api.compiled.ts', compileToModule({ routesImport: './routes', routes }))
```

```ts
// src/worker.ts — Cloudflare Workers entry
import compiled from './api.compiled'
export default compiled // { fetch }

// dev server instead: toFetchHandler(createApi({ routes: Object.values(routes), validateResponses: true }))
```

Measured under Node/V8 (same engine as workerd), Request → Response, against
the standard Workers stack:

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~225k ops/s | ~244k | ~187k | **~312k** |
| dynamic GET, params validated | ~195k ¹ | ~145k | ~174k | **~266k** |
| POST, body validated | ~49k ¹ | ~33k | ~51k | **~63k** |

<sub>¹ hono-bare does no validation; every @amritk/api column validates.</sub>

### Schemas from Zod, TypeBox, Valibot, Effect

Contracts take plain JSON Schema. Schemas authored in other libraries convert
via [`@amritk/adapters`](../adapters) before being placed in a contract.

## Scope notes

- JSON bodies only (`application/json`) for now — multipart, streaming, and
  content negotiation are out of scope for this first cut.
- Route paths use OpenAPI syntax (`/users/{id}`); a parameter owns its whole
  segment.
- Static paths always win over parameterized ones; parameterized routes match
  in registration order.
