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
- **The whole HTTP surface.** Streaming/raw replies with client-disconnect
  signals, raw body access for webhook signatures, body size limits,
  request-header schemas, hook chains for CORS/rate limits/security headers,
  and pluggable error envelopes — each shipped in both the runtime and
  compiled engines.
- **One dependency, many integrations.** Drizzle, Better Auth, Sentry, and a
  generated typed client (Hey API) connect through seams — `context`,
  `mounts`, `onError`, OpenAPI — not bundled SDKs. Recipes below.

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
| `context` | — | Per-request app context factory (database handles, sessions). See [App context](#app-context-drizzle-sessions-anything-per-request). |
| `validateResponses` | `false` | Validate reply bodies against the declared response schemas; mismatches become a 500. A development/test net. |
| `onError` | bare 500 | Map a thrown handler error to a response. Receives `(error, request, { route, env, executionContext })` — everything error reporting needs. The default never leaks the error message. |
| `errors` | built-in bodies | Reshape the pipeline's own cold-path responses (`notFound`, `invalidJson`, `payloadTooLarge`, `validationFailed`, `methodNotAllowed`) to match an existing wire format. |

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
- `request.headers` takes an object schema whose property names are header
  names (lookup is case-insensitive; write them lowercase). Only declared
  headers are read, values coerce like query parameters, and each property
  becomes an `in: 'header'` OpenAPI parameter — so `x-api-key`-style auth
  requirements document themselves.
- `request.cookies` works the same way for the `cookie` header: only declared
  names are read (tracking cookies never reach validation), values are
  unquoted and percent-decoded per the usual middleware conventions, and
  each property becomes an `in: 'cookie'` OpenAPI parameter.
- `HEAD` is served automatically wherever `GET` is (RFC 9110): the GET
  pipeline runs — validation, handler, response headers and all — and the
  adapter discards the body (cancelling streams rather than leaking them).
  Declaring an explicit `head` route overrides the fallback for its path.
- A known path requested with the wrong method answers
  `405 { error: 'method_not_allowed' }` with a sorted `allow` header
  (advertising `HEAD` whenever `GET` is served); unknown paths stay 404.
- Validation failures answer `400` with `{ error: 'validation_failed', source,
  errors }` where `errors` carries the same `{ message, path }` shape as
  `@amritk/runtime-validators` and `source` is `params`, `query`, `headers`,
  or `body`. The `errors` option reshapes this (and the other built-in
  bodies) when deployed clients already parse a different envelope.

### Streaming and raw responses

Declare a status with `contentType` and its body becomes a raw payload — a
`ReadableStream<Uint8Array>`, `Uint8Array`, or string that every adapter
sends untouched. This is the AI-token-stream / SSE / CSV-download shape; the
request side stays validated and documented, only the reply is raw:

```ts
const chat = defineRoute({
  method: 'post',
  path: '/chat',
  request: { body: chatBodySchema },
  responses: { 200: { contentType: 'text/plain; charset=utf-8' } },
  handler: ({ body, request }) => ({
    status: 200,
    // request.signal aborts when the client disconnects — stop generating.
    body: streamTokens(body.messages, request.signal),
  }),
})
```

### Raw request bodies and size limits

The pipeline only consumes the body stream when a `body` schema is declared,
and all reads share one buffered copy — so `request.readText()` /
`readBytes()` can be called repeatedly, in any combination, and even
alongside a declared body schema (parsed access *and* the exact signed bytes
in the same handler). A route that only needs the raw bytes — webhook
signature verification, uploads — simply declares no body schema:

```ts
const stripeWebhook = defineRoute({
  method: 'post',
  path: '/billing/webhook',
  request: {
    headers: { type: 'object', properties: { 'stripe-signature': { type: 'string' } }, required: ['stripe-signature'] },
  },
  responses: { 200: {}, 400: {} },
  handler: async ({ headers, request }) => {
    const payload = await request.readText() // exact signed bytes, never re-serialized
    const event = await stripe.webhooks.constructEventAsync(payload, headers['stripe-signature'], secret)
    // ...
    return { status: 200 }
  },
})
```

`toFetchHandler(api, { maxBodyBytes: 1_000_000 })` (also on `toNodeHandler`
and `compileToModule`) rejects larger bodies with a 413 — checked against
`content-length` up front, enforced on the running byte count as the body
streams in, for pipeline and handler-initiated reads alike.

### Hooks: CORS, rate limits, security headers

Hooks, `mounts`, and `createCors` are features of the **fetch adapter** —
`toNodeHandler` deliberately omits them, because every Node framework it
plugs into already has a middleware chain for CORS, rate limits, and
security headers (Express/Connect middleware runs before the handler; plain
`node:http` users can wrap the returned listener).

`toFetchHandler` takes two hook chains over the raw `Request`/`Response` —
deliberately not a middleware onion. `onRequest` gates run in order before
mounts and routing, and the first returned `Response` short-circuits;
`onResponse` decorators run on **every** outgoing response, including 404s,
gate replies, and mounted routers, which is what security headers and CORS
actually require:

```ts
import { createCors, toFetchHandler } from '@amritk/api'

const cors = createCors({ origin: (o) => o, credentials: true, exposeHeaders: ['x-demo-used'] })

const handler = toFetchHandler(api, {
  onRequest: [
    cors.onRequest, // answers preflights
    async (request, env) =>
      (await allowed(request, env)) ? undefined : new Response('{"error":"rate_limited"}', { status: 429 }),
  ],
  onResponse: [
    cors.onResponse,
    (response) => {
      response.headers.set('x-frame-options', 'DENY')
    },
  ],
})
// Compiled: compileToModule({ ..., onRequestExports: ['gate'], onResponseExports: ['stamp'] })
```

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

Everything `createApi`/`toFetchHandler` accept has a compiled equivalent that
references *exports of your routes module*, so both engines execute the same
values: `contextExport`, `mounts`, `onRequestExports`, `onResponseExports`,
`errorsExport`, `onErrorExport`, and `maxBodyBytes`.

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
the standard Workers stack — one session, same machine:

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~339k ops/s | ~361k | ~392k | **~530k** |
| dynamic GET, params validated | ~311k ¹ | ~209k | ~302k | **~381k** |
| POST, body validated | ~74k ¹ | ~63k | ~74k | **~82k** |

<sub>¹ hono-bare does no validation; every @amritk/api column validates.</sub>

Even the runtime (development) engine now sits at or above unvalidated Hono
while validating; the compiled engine leads every case by 22–57%.

### App context: Drizzle, sessions, anything per-request

Handlers receive a `context` value built by an app-supplied factory — the
home for database handles, sessions, and loggers. The factory runs **after
validation**, only for matched requests, and receives the platform `env`
(Cloudflare bindings; whatever you pass the Node adapter). Type it once with
`routeFactory` so every handler sees the real shape:

```ts
// app-context.ts — the factory and the type live together so they cannot drift
import { drizzle } from 'drizzle-orm/d1'
import { routeFactory, type ContextFactoryInput } from '@amritk/api'

export type AppContext = { db: ReturnType<typeof drizzle> }
export const defineAppRoute = routeFactory<AppContext>()
export const createContext = ({ env }: ContextFactoryInput): AppContext => ({
  db: drizzle((env as Env).DB),
})
```

```ts
// routes.ts
export const listUsers = defineAppRoute({
  method: 'get',
  path: '/users',
  responses: { 200: { body: { type: 'array' } } },
  handler: async ({ context }) => ({ status: 200, body: await context.db.select().from(users) }),
})
```

```ts
const api = createApi({ routes: [listUsers], context: createContext })
// Workers: env arrives per request automatically — toFetchHandler(api)
// Node:    toNodeHandler(api, { env: process.env })
// Compiled: compileToModule({ routesImport: './routes', routes, contextExport: 'createContext' })
```

### Auth: Better Auth

Two touch points, both first-class. Better Auth's own endpoints are a
self-contained fetch handler that owns `/api/auth/*` — mount it by prefix and
the raw `Request`/`Response` pass straight through (streaming intact):

```ts
export const auth = betterAuth({ /* ... */ })

const handler = toFetchHandler(api, {
  mounts: { '/api/auth': (request) => auth.handler(request) },
})
// Express instead: app.all('/api/auth/*', toNodeHandler(auth)); app.use(toNodeHandler(api))
// Compiled: compileToModule({ ..., mounts: { '/api/auth': 'authMountHandler' } })
```

Sessions flow through the app context, and guarding is part of the contract —
a protected route *declares* its 401, so the auth behavior shows up in the
OpenAPI document like everything else:

```ts
export const createContext = async ({ request }: ContextFactoryInput) => ({
  session: await auth.api.getSession({
    headers: new Headers({ cookie: request.header('cookie') ?? '' }),
  }),
})

export const getProfile = defineAppRoute({
  method: 'get',
  path: '/profile',
  responses: {
    200: { body: profileSchema },
    401: { body: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
  },
  handler: ({ context }) =>
    context.session === null
      ? { status: 401, body: { error: 'unauthorized' } }
      : { status: 200, body: toProfile(context.session.user) },
})
```

If only some routes need the session, make the context lazy (`session: () =>
memoizedLookup()`) so public routes never pay for the cookie check.

### Error reporting: Sentry

`onError` receives the matched route contract and the platform values, which
is everything error reporting needs — the route *pattern* (`/users/{id}`,
not `/users/8231`) is what groups issues cleanly, and Workers-side Sentry
clients read their DSN from `env` and flush via `executionContext`.
`createSentry` packages this: it takes a capture **function**, not an SDK
client, so nothing gets bundled and any client fits (`@sentry/node`,
`@sentry/cloudflare`, Toucan):

```ts
import { createApi, createSentry } from '@amritk/api'
import { Toucan } from 'toucan-js'

const sentry = createSentry({
  capture: (error, { route, method, env, executionContext }) => {
    const client = new Toucan({ dsn: (env as Env).SENTRY_DSN, context: executionContext as ExecutionContext })
    client.setTag('route', `${method} ${route}`)
    client.captureException(error)
  },
})

const api = createApi({ routes, onError: sentry.onError })
// Compiled: compileToModule({ ..., onErrorExport: 'onError' })
```

A throwing capture is swallowed (the client still gets its 500), and
validation failures are not captured — those are the caller's bug.

### Typed client: Hey API

The generated OpenAPI document is verified [Hey API](https://heyapi.dev)
input, which turns it into a typed fetch SDK — a framework-agnostic
replacement for RPC clients like Hono's `hc`:

```bash
bunx @hey-api/openapi-ts -i http://localhost:3000/openapi.json -o src/client
```

```ts
import { getUser } from './client/sdk.gen'
const { data } = await getUser({ path: { id: 7 } }) // data: { id: number; name: string }
```

Client and server both derive from the same schemas, so they cannot drift —
this package's integration test generates a client from `toOpenApi` output
and asserts the contract types (typed path params, required headers, error
variants) come through.

### Schemas from Zod, TypeBox, Valibot, Effect

Contracts take plain JSON Schema. Schemas authored in other libraries convert
via [`@amritk/adapters`](../adapters) before being placed in a contract.

## Integration philosophy

Deliberately **recipes over plugins, seams over SDKs** — the core's one
dependency is `@amritk/runtime-validators`, and third-party SDK versions stay
yours:

| Concern | Seam |
|:--|:--|
| Drizzle / any ORM | `context` factory builds the handle per request from `env` |
| Better Auth / any self-contained router | `mounts` passthrough + session lookup in `context` |
| Sentry / error reporting | `onError` (`createSentry` packages it) |
| Rate limits, feature flags, CSRF, origin checks | `onRequest` gates |
| Security headers, CORS | `onResponse` decorators / `createCors` |
| Typed clients | generated from the OpenAPI document (Hey API) |

## Requirements and stability

- **ESM-only.** There is no CommonJS entry point; `require('@amritk/api')`
  works only on Node versions that support `require(esm)` (22.12+).
- **Runtimes.** Any fetch-standard runtime (Cloudflare Workers, Bun, Deno,
  edge platforms) for `toFetchHandler`/`compileToModule`; Node **≥ 20** for
  `toNodeHandler` (declared in `engines`).
- **Versioning.** The package is pre-1.0: breaking changes land in **minor**
  versions (with changelog entries), patches stay compatible. The contract
  shape (`defineRoute` fields), the `ApiRequest`/`ApiResponse` seam, and the
  wire format of built-in error bodies are treated as stable; anything
  exported purely for `compileToModule` output (`buildQueryObjectFromString`,
  `decodeSegment`, …) is internal plumbing and may change as the compiler
  does — regenerate compiled modules when upgrading.

## Scope notes

- Request bodies are JSON (`application/json`) as far as *validation* goes;
  raw bytes are always available via `readText`/`readBytes` (webhooks,
  uploads), and raw/streaming **responses** are first-class via `contentType`.
  Multipart parsing is not built in.
- Route paths use OpenAPI syntax (`/users/{id}`); a parameter owns its whole
  segment.
- Static paths always win over parameterized ones; parameterized routes match
  in registration order.
