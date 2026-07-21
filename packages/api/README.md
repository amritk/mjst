# @amritk/api

Contract-first, framework-agnostic API layer built on [mjst](../../README.md)'s
JSON Schema tooling. Declare each route once — method, path, request schemas, response
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
- **Contract/handler split with a derived typed client.** Declare contracts as
  pure data (`defineContract`), bind server handlers separately
  (`implementRoute`), and derive a typed fetch client (`createClient`) from
  the same literals — no codegen, browser-safe imports, the `hc` replacement
  for teams leaving Hono RPC.
- **One dependency, many integrations.** Drizzle, Better Auth, Sentry, and
  typed clients connect through seams — `context`, `mounts`, `onError`,
  `locals`, OpenAPI — not bundled SDKs. Recipes below.

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
document (configurable via `openApiPath`) — serialized once per process and
sent with a strong `etag` + `cache-control: no-cache`, answering `304` to a
matching `if-none-match`. Note: for the types to flow, write schemas inline
(as above) or declare shared ones `as const` — a plain `const` widens the
literal before `defineRoute` sees it.

### Contracts without handlers (browser-safe)

`defineRoute` couples the contract to its handler, which is perfect for a
server-only codebase — but a frontend that wants the contract types must not
bundle server code. `defineContract` declares the same contract as **pure
data**, `implementRoute` binds the handler server-side, and the one-shot
`defineRoute` keeps working unchanged (every route *is* a contract):

```ts
// contracts.ts — imported by server AND browser
import { defineContract } from '@amritk/api'

export const getUser = defineContract({
  method: 'get',
  path: '/users/{id}',
  request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  responses: {
    200: { body: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] } },
    404: {},
  },
})
```

```ts
// routes.ts — server only
import { implementRoute, routeImplementer } from '@amritk/api'
import * as contracts from './contracts'

export const getUser = implementRoute(contracts.getUser, ({ params }) =>
  params.id === 1 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 },
)

// With an app context, bind the implementer once (the routeFactory counterpart):
const implementAppRoute = routeImplementer<AppContext>()
export const getProfile = implementAppRoute(contracts.getProfile, ({ context }) => /* ... */)
```

### Typed client: `createClient`

`createClient` derives a typed fetch client from a record of contracts — no
codegen, no OpenAPI round-trip, works in any browser/worker/Node bundle. The
same literals that type the handlers type each call, so client and server
cannot drift. This is the framework-agnostic replacement for Hono's `hc`:

```ts
// client.ts — browser bundle; pulls in zero server code
import { buildParamPath, createClient, isUnexpectedStatusError } from '@amritk/api'
import * as contracts from './contracts'

const client = createClient(contracts, 'https://api.example.com', {
  headers: () => ({ authorization: `Bearer ${readToken()}` }), // static record or (async) function
  fetch: myFetch, // injectable for tests; defaults to global fetch
  pathParams: buildParamPath, // opt-in: only needed for {param} paths
  fetchOptions: { credentials: 'include' }, // RequestInit extras (credentials, cache, redirect, …)
  timeoutMs: 10_000, // default per-call timeout; composes with a per-call signal
})

const reply = await client.getUser({ params: { id: 7 }, signal: AbortSignal.timeout(5000) })
if (reply.status === 200) reply.body.name // typed from the schema — narrowing on status
if (reply.status === 404) /* declared, typed, no body */;
```

- **Replies are a discriminated union on `status`,** derived from the
  `responses` map. JSON statuses carry a typed `body` (parsed eagerly);
  statuses declared with a raw `contentType` carry only the untouched
  `Response` — read the stream and headers yourself (the AI-chat shape):

  ```ts
  const chat = await client.chat({ body: { message: 'hi' }, headers: { 'x-api-key': key } })
  if (chat.status === 200) for await (const chunk of chat.response.body) render(chunk)
  ```

- **Inputs are typed per slot:** declared `params`/`query`/`body`/`cookies`
  are required and schema-typed, `headers` accepts the declared shape plus
  ad-hoc extras, and a per-call `signal` cancels. Contracts with no request
  slots call with no argument at all (`client.health()`). Every call also
  accepts `fetchOptions` (per-call `RequestInit` extras, merged over the
  client-level ones) and `timeoutMs` (overriding the client default; a
  timeout and a caller `signal` compose via `AbortSignal.any`). Requests
  send `accept: application/json` unless a header overrides it.
- **Cookies and browsers:** the `cookies` slot serializes into the `cookie`
  request header, which browsers forbid scripts from setting — it works from
  Node/undici/workers only. Browser cookie auth uses server-set cookies plus
  `fetchOptions: { credentials: 'include' }`.
- **A declared status whose body fails to parse** (a proxy truncation, a
  gateway HTML page under a JSON status) throws a recognizable error —
  `isMalformedBodyError(error)` — carrying the consumed `Response` and the
  parse error as `cause`, instead of a bare `SyntaxError`.
- **Wire formats beyond JSON are opt-in imports:** JSON bodies and query
  serialization (array values repeat the key) are built in; contracts with
  `bodyType: 'form'` / `'multipart'` (urlencoded pairs / `FormData` with
  `File` values intact) need their serializer registered, and `{param}` path
  templates need `buildParamPath` (segment-encoded; greedy `{path+}` keeps
  its slashes):

  ```ts
  import { buildParamPath, createClient, formBodySerializer, multipartBodySerializer } from '@amritk/api'

  const client = createClient(contracts, url, {
    serializers: [formBodySerializer, multipartBodySerializer], // only what you send
    pathParams: buildParamPath, // only if any path has {params}
  })
  ```

  A call that needs an unregistered piece throws with the fix in the
  message; JSON-only apps with static paths pass nothing and bundle none of
  it. A custom `BodySerializer` (any `bodyType`, including `'json'` to
  override the built-in encoder) is a `{ bodyType, serialize, contentType? }`
  object.
- **Undeclared statuses throw** (instead of poisoning the union): catch and
  inspect with `isUnexpectedStatusError(error)` — the unread `Response` rides
  on the error. Declare the statuses you want to handle in the contract.
- **Name wire types from the contracts** — the `…Of` helpers extract every
  schema-typed shape an app would otherwise re-declare by hand or generate:
  `ResponseBodyOf` (one status's body), `SuccessBodyOf` / `ErrorBodyOf` (the
  generated-SDK-style data and error unions, split 2xx vs 4xx/5xx),
  `ResponseStatusOf` (the declared statuses, for exhaustive switches),
  `RequestParamsOf` / `RequestQueryOf` / `RequestBodyOf` /
  `RequestHeadersOf` / `RequestCookiesOf` (the request slots, `undefined`
  when undeclared), and `ClientReplyOf` / `RouteReplyOf` (the client and
  handler reply unions). Error payloads become named exports instead of
  inline `as { ... }` casts at every use site:

  ```ts
  import type { ErrorBodyOf, RequestBodyOf, ResponseBodyOf } from '@amritk/api'

  // The 402 body, exactly as the contract declares it — no codegen.
  export type DemoLimitBody = ResponseBodyOf<typeof contracts.demoChat, 402>
  // Every declared error payload of the operation, as one union.
  export type DemoChatError = ErrorBodyOf<typeof contracts.demoChat>
  // What a form model holds before calling the client.
  export type DemoChatInput = RequestBodyOf<typeof contracts.demoChat>
  ```

The OpenAPI → [Hey API](https://heyapi.dev) route still works for external
consumers who want a standalone generated SDK (`bunx @hey-api/openapi-ts -i
http://localhost:3000/openapi.json -o src/client`); `createClient` is the
lighter path for monorepo-internal frontends.

#### Browser bundle size: the contract-slimming plugin

At runtime the client reads only a sliver of each contract — `method`,
`path`, `request.bodyType`, whether a `body` schema exists, and each response
status's `contentType` marker. The request/response schemas, `refine`,
`summary`/`description`, tags, and security requirements are server and
OpenAPI freight, and they scale with route count. The `@amritk/api/bundler`
plugin (Vite and `Bun.build`) strips them from `defineContract` call sites in
browser builds; types are compile-time, so nothing changes for the consumer,
and dropped schema references become tree-shakeable:

```ts
// vite.config.ts
import { stripContractsVite } from '@amritk/api/bundler'

export default defineConfig({ plugins: [stripContractsVite()] })
```

esbuild and Rollup builds use `stripContractsEsbuild()` / `stripContractsRollup()`
from the same subpath, with identical `exclude` semantics. The strip is
line-preserving — removed spans keep their newlines — so downstream
sourcemaps stay line-accurate.

```ts
// build.ts — Bun.build; add it to the browser build only
import { stripContractsBun } from '@amritk/api/bundler'

await Bun.build({ entrypoints: ['./src/client.ts'], target: 'browser', plugins: [stripContractsBun()] })
```

The transform is deliberately conservative: call sites it cannot parse with
certainty (spreads, computed keys, explicit type arguments, aliased imports
of `defineContract`) are left byte-for-byte untouched, unknown contract
fields are kept, SSR modules and the Vite dev server are never touched — the
failure mode is a bigger bundle, never a broken one. The Vite plugin runs
`enforce: 'pre'`, `apply: 'build'`.

Two caveats. First, the strip assumes the browser only calls contracts
through `createClient`. If your app itself reads contract schemas at runtime
— client-side form validation against `contract.request.body`, in-browser
OpenAPI rendering — those modules must keep their freight: pass
`{ exclude: /pattern/ }` (matched against the module id / file path) to
either plugin, or leave the plugin off. Second, only direct
`defineContract({ ... })` identifier calls are rewritten; a renamed import
or a wrapper function keeps its call sites intact (and its bytes).

For other bundlers, the underlying source-to-source transform is exported as
`stripContractFields(source)` — wire it into any pipeline that can run a
per-module text transform (esbuild `onLoad`, a Rollup `transform` hook).

Measured on a realistic widget consumer — three JSON-only contracts with
static paths, bundled with `Bun.build` (`target: 'browser'`, minified;
enforced by `src/bundler/strip-contracts-bun.test.ts`):

| Bundle                                | minified | gzip    |
| ------------------------------------- | -------- | ------- |
| 0.3.0 client (everything built in)    | 3.6 kB   | 1.7 kB  |
| 0.4.0 client, no plugin               | 3.7 kB   | 1.7 kB  |
| 0.4.0 client + strip plugin           | 2.7 kB   | 1.4 kB  |
| contract data alone, before → after   | 1.3 kB → 0.31 kB | 0.57 kB → 0.19 kB |

The contract-data row is the one that scales: the plugin removes ~75% of
every contract's bytes (~0.3 kB minified per route in this fixture), so the
gap widens with route count. The client core itself is a fixed cost, and the
opt-in serializer/path split keeps it flat: form, multipart, and `{param}`
handling are no longer bundled unless the app registers them.

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
| `validateResponses` | `false` | Validate reply bodies (and declared reply headers) against the response contracts; mismatches become a 500. A development/test net. |
| `onError` | bare 500 | Map a thrown handler error to a response. Receives `(error, request, { route, env, executionContext })` — everything error reporting needs. The default never leaks the error message. |
| `errors` | built-in bodies | Reshape the pipeline's own cold-path responses (`notFound`, `invalidJson`, `invalidBody`, `unsupportedMediaType`, `payloadTooLarge`, `validationFailed`, `methodNotAllowed`) to match an existing wire format. |
| `observe` | — | Called once per matched request with `{ route, request, status, durationMs, env, executionContext }` — the seam for per-route latency metrics and structured request logs. See [Observability](#observability-metrics-and-request-logs). |
| `observeUnmatched` | — | The unmatched-request counterpart: called once per 404/405 with `route: undefined`, for request-logging parity with framework middleware. |
| `servers` / `securitySchemes` / `security` / `tags` | — | Document-level OpenAPI settings: base URLs, named auth schemes (`components.securitySchemes`), the default security requirement, and tag objects (`name`/`description`/`externalDocs`). Routes add `security` / `deprecated` per operation. |

### Validation semantics

- Path and query parameters arrive as strings, so declared `number` /
  `integer` / `boolean` / `array` properties are coerced first (from a plan
  computed at startup — no per-request schema inspection). A value that does
  not parse stays a string and fails validation with a proper type error.
- Repeated query keys (`?tag=a&tag=b`) accumulate into arrays when the schema
  declares an array; undeclared keys pass through as strings so
  `additionalProperties` rules still apply.
- Declaring `request.body` makes a body required. The default encoding is
  JSON; `bodyType: 'form'` and `bodyType: 'multipart'` switch it (see below).
  A JSON body that fails to parse is a `400 { error: 'invalid_json' }`; a
  form/multipart body that fails to parse is a `400 { error: 'invalid_body' }`.
- A request whose `content-type` contradicts the declared body type answers
  `415 { error: 'unsupported_media_type' }` before any read. A request with
  *no* content-type gets the benefit of the doubt and fails on the parse
  instead, so bare `curl` and hand-rolled clients keep working. JSON accepts
  `application/json` and `+json` structured suffixes.
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
  (advertising `HEAD` whenever `GET` is served, and `OPTIONS` always);
  unknown paths stay 404.
- `OPTIONS` on a known path answers `204` with the same `allow` header
  automatically; declaring an explicit `options` route overrides it. CORS
  preflights are answered earlier by the `createCors` gate when configured.
- Validation failures answer `400` with `{ error: 'validation_failed', source,
  errors }` where `errors` carries the same `{ message, path }` shape as
  `@amritk/runtime-validators` and `source` is `params`, `query`, `headers`,
  or `body`. The `errors` option reshapes this (and the other built-in
  bodies) when deployed clients already parse a different envelope.

### Cross-field refinement

Per-slot JSON Schema cannot see across fields. A route (or contract) may
declare `refine`, which runs (sync or async — a returned promise is awaited)
**after** every declared slot has validated — so its inputs are already typed
and coerced — and **before** the context factory and handler. Returned issues reject the request through the
standard `validation_failed` envelope (and the `validationFailed` formatter),
with your own `path`/`message`; `undefined` or `[]` accepts it. A thrown
refine takes the `onError` path like any handler error:

```ts
const chat = defineRoute({
  method: 'post',
  path: '/chat',
  request: { body: chatBodySchema },
  refine: ({ body }) => {
    const total = body.messages.reduce((n, m) => n + m.content.length, 0)
    return total <= 64_000
      ? undefined
      : [{ path: '/messages', message: `total message length ${total} exceeds 64k` }]
  },
  responses: { 200: { contentType: 'text/event-stream' } },
  handler: /* ... */,
})
```

### Form and multipart bodies

`bodyType` selects how the declared body schema arrives on the wire — the
parser, the 415 check, and the OpenAPI requestBody content key all follow it:

```ts
const signup = defineRoute({
  method: 'post',
  path: '/signup',
  request: {
    // application/x-www-form-urlencoded: fields coerce like query parameters
    // (typed keys coerce from strings, array keys accumulate repeats).
    body: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer', minimum: 18 } },
      required: ['name', 'age'],
    },
    bodyType: 'form',
  },
  responses: { 201: {} },
  handler: ({ body }) => /* body.age is a number */ ({ status: 201 }),
})

const upload = defineRoute({
  method: 'post',
  path: '/upload',
  request: {
    // multipart/form-data: string parts coerce like form fields, file parts
    // reach the handler as File objects. Declare file properties WITHOUT a
    // `type` keyword ({} or { contentMediaType: 'image/png' }) — a File is
    // not a string, so `type: 'string'` would reject it.
    body: {
      type: 'object',
      properties: { title: { type: 'string' }, attachment: {} },
      required: ['title', 'attachment'],
    },
    bodyType: 'multipart',
  },
  responses: { 200: {} },
  handler: async ({ body }) => {
    const file = body.attachment as File
    await save(file.name, new Uint8Array(await file.arrayBuffer()))
    return { status: 200 }
  },
})
```

Multipart parsing is delegated to the platform's `Response#formData` (undici
on Node, native on Workers/Bun/Deno) over the same shared buffered read as
everything else — `maxBodyBytes` still caps uploads. Repeated file keys keep
the last file; repeated string keys accumulate when the schema declares an
array.

Sending these formats from the derived client is opt-in: register
`formBodySerializer` / `multipartBodySerializer` in `createClient` (see the
typed-client section above) so JSON-only apps never bundle them.

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

Both adapters apply backpressure: the fetch adapter hands the stream to the
platform `Response`, and the Node adapter awaits `drain` whenever a write
overruns the socket buffer, so a fast producer never buffers unbounded
memory against a slow client.

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
streams in, for pipeline and handler-initiated reads alike. **The default is
1 MiB** — unbounded reads are opt-in via `maxBodyBytes: Infinity`, so an
unconfigured deployment is not a memory-exhaustion vector.

### The platform request: `request.raw`

`ApiRequest` is framework-neutral on purpose, but platforms attach real data
to their native request objects — Cloudflare's `request.cf` carries geo
coordinates, ASN, TLS metadata. Each adapter exposes its native request as
`request.raw`: the Web `Request` on the fetch adapter and compiled engine,
the `IncomingMessage` on the Node adapter. It is typed `unknown` because
reading it is platform-specific **by design** — the cast at the use site is
the honest record of that coupling:

```ts
const nearby = defineRoute({
  method: 'get',
  path: '/nearby',
  responses: { 200: { body: resultsSchema } },
  handler: ({ request }) => {
    const cf = (request.raw as Request & { cf?: IncomingRequestCfProperties }).cf
    return { status: 200, body: search(cf?.latitude, cf?.longitude) }
  },
})
```

The context factory sees the same request, so platform data can flow into the
app context once instead of per handler. Portable code should keep `raw`
reads behind a seam (a context field) so only one module knows the platform.

### Multiple `set-cookie` headers

Reply headers accept `string | string[]` per name. An array is sent as that
many separate header lines — the only correct encoding for repeated
`set-cookie`, which must never be comma-folded (RFC 6265). This is what
session + CSRF (Better Auth) or session + Stripe-state flows need:

```ts
const login = defineRoute({
  method: 'post',
  path: '/login',
  request: { body: credentialsSchema },
  responses: { 200: { body: profileSchema } },
  handler: async ({ body }) => ({
    status: 200,
    headers: {
      'set-cookie': [
        `session=${await createSession(body)}; Path=/; HttpOnly; Secure`,
        `csrf=${issueCsrf()}; Path=/; Secure`,
      ],
    },
    body: profile,
  }),
})
```

Both engines serialize arrays identically (the differential corpus covers
it), and the Node adapter validates each element before `writeHead`. With
`validateResponses` on, a declared response-header schema sees the value as
given — a string or the array — so declare `anyOf` if you validate a header
that can repeat.

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
// createCors throws at setup on origin: '*' + credentials: true — a
// combination every browser rejects.

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

### Per-request state: `locals`

Every request carries one shared scratch bag. Gates receive it as their
fourth argument, decorators as their third, the context factory as
`input.locals`, and handlers as `request.locals` — so an auth gate resolves
the tenant **once** and everyone downstream reads it, and a rate-limit gate's
counters get stamped onto the response without recomputing:

```ts
const handler = toFetchHandler(api, {
  onRequest: [
    async (request, env, _executionContext, locals) => {
      const tenant = await resolveTenant(request, env)
      if (tenant === undefined) return new Response('{"error":"unauthorized"}', { status: 401 })
      locals.tenant = tenant // handlers see request.locals.tenant
      const usage = await checkDemoLimit(tenant, env) // KV-backed rate limit
      if (usage.blocked) return new Response('{"error":"rate_limited"}', { status: 429 })
      locals.usage = usage
      return undefined
    },
  ],
  onResponse: [
    (response, _request, locals) => {
      const usage = locals.usage as Usage | undefined
      if (usage !== undefined) response.headers.set('x-demo-remaining', String(usage.remaining))
    },
  ],
})
// Compiled: identical wiring via onRequestExports/onResponseExports.
```

The bag is plain `Record<string, unknown>` — no reserved keys. Without hooks
it is created lazily on first `request.locals` access, so untouched requests
never allocate. `onError` handlers and error formatters see the same bag
through their `request`, so a 404 logger can still label the tenant.

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
`errorsExport`, `onErrorExport`, `observeExport`, `observeUnmatchedExport`,
`compileExport` (a custom `ValidatorCompiler` — the compiled counterpart of
`compile`, so generated validators behave identically in production),
`validateResponses` (the same reply-contract net as the runtime engine, for
staging builds), `maxBodyBytes`, and the OpenAPI extras (`servers`,
`securitySchemes`, `security`, `tags`). Contract features (`refine`,
`string[]` headers, `request.raw`, `locals`) work identically in both — the
differential corpus pins each one.

Staleness is detected, not silent: the emitted module bakes a
`contractsHash` and recomputes it over the imported routes at init — a
schema or path edited after compilation logs a one-line
"stale compiled module" warning (never a throw) until you regenerate. The
`mjst compile-api` CLI subcommand wraps the build step
(`mjst compile-api ./src/routes.ts --out src/api.compiled.ts`), and
`fetchToNodeHandler` bridges the compiled `fetch` export onto
`node:http`/Express so Node deployments get the compiled fast path too.

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

### Observability: metrics and request logs

`observe` is called once per matched request — validation failures and
handler errors included — with the route *pattern* (`/users/{id}`, the
dimension metrics group by), the outcome status, and the pipeline duration.
Unmatched requests (404/405) and the OpenAPI document are not observed, a
throwing observer is swallowed, and when unset the hot path pays nothing:

```ts
const api = createApi({
  routes,
  observe: ({ route, status, durationMs }) => {
    metrics.histogram('http.server.duration', durationMs, { route: route.path, status })
  },
})
// Compiled: compileToModule({ ..., observeExport: 'observe' })
```

For full request-log parity with framework middleware — every request logged,
not just matched ones — add `observeUnmatched`, called once per 404/405 with
`route: undefined` (a separate hook so `observe`'s `route` stays
non-optional). One logger can serve both:

```ts
const logRequest = ({ route, request, status, durationMs }: RequestObservation | UnmatchedObservation) => {
  log.info(`${request.method} ${route?.path ?? request.path} → ${status} in ${durationMs.toFixed(1)}ms`)
}
const api = createApi({ routes, observe: logRequest, observeUnmatched: logRequest })
// Compiled: compileToModule({ ..., observeExport: 'logRequest', observeUnmatchedExport: 'logRequest' })
```

The OpenAPI document path and gate short-circuits remain unobserved by both
hooks.

Keep the observer synchronous-fast — fire-and-forget any I/O (or hand it to
`executionContext.waitUntil` on Workers, which the observation carries).

### OpenAPI: servers, auth schemes, shared components

Document-level settings pass through `createApi` (and `compileToModule`)
verbatim; routes annotate their own operations:

```ts
const api = createApi({
  routes,
  servers: [{ url: 'https://api.example.com' }],
  securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  security: [{ bearerAuth: [] }], // default for every operation
})

const login = defineRoute({ method: 'post', path: '/login', security: [], /* public */ ... })
const legacy = defineRoute({ method: 'get', path: '/v1/users', deprecated: true, ... })
```

Give a shared schema a `title` and reuse the same object across contracts —
it is hoisted into `components.schemas` and referenced with `$ref`, so
generated clients get one `User` type instead of N structurally identical
copies. Titles that collide with *different* contents stay inline (never a
wrong `$ref`). Schemas carrying internal `$ref`s (recursive shapes with
`$defs`) are always hoisted, with their refs re-rooted under the component,
so they stay resolvable in the document. Every operation gets an
`operationId` — explicit `operationId` on the route wins, otherwise one is
synthesized from method + path (`get /users/{id}` → `getUsersById`);
duplicates throw at startup. `info` accepts `contact`, `license`, and
`termsOfService`, and multipart file parts are documented with `encoding`
entries (`contentMediaType` or `application/octet-stream`). Response contracts may also declare notable headers —
`responses: { 200: { headers: { 'x-ratelimit-remaining': { type: 'integer' } } } }`
— documented as OpenAPI header objects and checked under `validateResponses`.

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

### Typed client for external consumers: Hey API

For consumers outside the monorepo (who cannot import your contracts), the
generated OpenAPI document is verified [Hey API](https://heyapi.dev) input,
which turns it into a standalone typed fetch SDK:

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
variants) come through. Monorepo-internal frontends should prefer
[`createClient`](#typed-client-createclient), which needs no codegen at all.

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
| Metrics, request logging | `observe` + `observeUnmatched` (route pattern, status, duration) |
| Rate limits, feature flags, CSRF, origin checks | `onRequest` gates |
| Security headers, CORS | `onResponse` decorators / `createCors` |
| Auth ↔ handler state (resolved tenants, counters) | per-request `locals` bag |
| Platform data (Workers `request.cf` geo/ASN) | `request.raw` escape hatch |
| Typed clients | `createClient` from shared contracts; Hey API from OpenAPI for external consumers |

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

- Request bodies validate as JSON, form-encoded, or multipart per the
  contract's `bodyType`; raw bytes are always available via
  `readText`/`readBytes` (webhook signatures), and raw/streaming
  **responses** are first-class via `contentType`.
- Route paths use OpenAPI syntax (`/users/{id}`); a parameter owns its whole
  segment. A greedy tail parameter — `/files/{path+}`, the AWS API Gateway
  convention — captures one or more remaining segments, decoded individually
  and joined with `/` (`/files/docs/2026/q1.pdf` → `path: 'docs/2026/q1.pdf'`).
  It must be the last segment; the bare prefix (`/files`) stays a 404.
- Static paths always win over parameterized ones; parameterized routes match
  in registration order.
