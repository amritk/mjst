# @amritk/api

Contract-first, framework-agnostic API layer built on [mjst](../../README.md)'s
JSON Schema tooling. Declare each route once — method, path, request schemas, response
schemas, handler — and get typed handlers, fast request/response validation,
and an OpenAPI 3.2 document with **no extra code**. Thin adapters connect the
same API to Hono, Next.js, Bun, Cloudflare Workers, Deno (fetch), and
Express, Fastify, or raw `node:http` (Node).

- **One contract, everything derived.** The JSON Schemas in a route type the
  handler (via `FromSchema`), validate requests at runtime, and embed verbatim
  into the OpenAPI document — OpenAPI 3.2's schema dialect *is* JSON Schema
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
import { defineContract } from '@amritk/api/client'

// One object is the single source of truth: the client covers exactly these
// keys, and adding an endpoint here wires it into client and server at once.
export const contracts = {
  getUser: defineContract({
    method: 'get',
    path: '/users/{id}',
    request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
    responses: {
      200: { body: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] } },
      404: {},
    },
  }),
  getProfile: defineContract({
    method: 'get',
    path: '/users/{id}/profile',
    request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
    responses: { 200: {} },
  }),
}
```

```ts
// routes.ts — server only
import { implementRoute, routeImplementer } from '@amritk/api'
import { contracts } from './contracts'

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
import { buildParamPath, createClient, isUnexpectedStatusError, toSearchParams } from '@amritk/api/client'
import { contracts } from './contracts'

const client = createClient(contracts, 'https://api.example.com', {
  headers: () => ({ authorization: `Bearer ${readToken()}` }), // static record or (async) function
  fetch: myFetch, // injectable for tests; defaults to global fetch
  pathParams: buildParamPath, // opt-in: only needed for {param} paths
  queryParams: toSearchParams, // opt-in: only needed for calls that send query
  fetchOptions: { credentials: 'include' }, // RequestInit extras (credentials, cache, redirect, …)
  timeoutMs: 10_000, // default per-call timeout; composes with a per-call signal
})

const reply = await client.getUser({ params: { id: 7 }, signal: AbortSignal.timeout(5000) })
if (reply.status === 200) reply.body.name // typed from the schema — narrowing on status
if (reply.status === 404) /* declared, typed, no body */;
```

- **`@amritk/api/client` is the browser-safe entry:** everything above —
  `createClient`, `defineContract`, the opt-in serializers, the error
  predicates, the `…Of` type helpers, and the client-side auth helpers
  (`createCsrfHeader`, `createTokenRefresh`, `createRefreshFetch`) — with an
  import graph that never
  touches a server module or a `node:` built-in, guaranteed by a test.
  Importing from the root `@amritk/api` works too (`sideEffects: false`
  tree-shakes the server half out of the final bundle), but the root barrel
  makes bundlers *resolve* the server adapters and print
  `node:http`/`node:stream` externalization warnings along the way; the
  subpath never triggers them.
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
  Node/undici/workers only, and is opt-in for exactly that reason: register
  `cookies: appendCookies` to use it; a browser bundle omits it and never
  carries the code. Browser cookie auth uses server-set cookies plus
  `fetchOptions: { credentials: 'include' }`.
- **A declared status whose body fails to parse** (a proxy truncation, a
  gateway HTML page under a JSON status) throws a recognizable error —
  `isMalformedBodyError(error)` — carrying the consumed `Response` and the
  parse error as `cause`, instead of a bare `SyntaxError`.
- **Everything beyond plain JSON calls is an opt-in import:** JSON bodies and
  the raw `text`/`bytes` bodies (sent verbatim) are built in; the rest is
  registered explicitly so a JSON-only, static-path app bundles none of it.
  Contracts with `bodyType: 'form'` / `'multipart'` (urlencoded pairs /
  `FormData` with `File` values intact) need their serializer, `{param}` path
  templates need `pathParams: buildParamPath` (segment-encoded; greedy
  `{path+}` keeps its slashes), query strings need `queryParams:
  toSearchParams` (array values repeat the key, `undefined` skipped), and the
  Node-only `cookies` slot needs `cookies: appendCookies`:

  ```ts
  import {
    appendCookies,
    buildParamPath,
    createClient,
    formBodySerializer,
    multipartBodySerializer,
    toSearchParams,
  } from '@amritk/api/client'

  const client = createClient(contracts, url, {
    serializers: [formBodySerializer, multipartBodySerializer], // only what you send
    pathParams: buildParamPath, // only if any path has {params}
    queryParams: toSearchParams, // only if any call sends query
    cookies: appendCookies, // only from Node/undici/workers
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
  import type { ErrorBodyOf, RequestBodyOf, ResponseBodyOf } from '@amritk/api/client'

  // The 402 body, exactly as the contract declares it — no codegen.
  export type DemoLimitBody = ResponseBodyOf<typeof contracts.demoChat, 402>
  // Every declared error payload of the operation, as one union.
  export type DemoChatError = ErrorBodyOf<typeof contracts.demoChat>
  // What a form model holds before calling the client.
  export type DemoChatInput = RequestBodyOf<typeof contracts.demoChat>
  ```

For consumers outside the monorepo, the generated OpenAPI document feeds
whichever SDK generator they already use; `createClient` is the lighter path
for monorepo-internal frontends, and needs no codegen at all.

#### Browser bundle size: the contract strip

At runtime the client reads only a sliver of each contract — `method`,
`path`, `request.bodyType`, whether a `body` schema exists, and each response
status's `contentType` marker. The request/response schemas, `refine`,
`summary`/`description`, and tags are server and OpenAPI freight, and they
scale with route count. `@amritk/api/bundler` exports the transform that
removes them from `defineContract` call sites in browser builds — types are
compile-time, so nothing changes for the consumer, and dropped schema
references become tree-shakeable:

- `stripContractFields(source)` — source in, source out, unchanged when there
  was nothing to rewrite.
- `isScannableId(id)` — the module-id filter to put in front of it (TS/JS
  extensions, tolerating Vite's `?query` suffixes).

Deliberately not a plugin per bundler: every bundler exposes a per-module
text hook, the wiring against yours is a few lines, and those lines are
yours to place — which build, which modules, which `exclude`. The subpath
imports nothing, `node:*` included, so a config file in any runtime can load
it.

```ts
// vite.config.ts — Rollup is the same, minus enforce/apply/ssr
import { isScannableId, stripContractFields } from '@amritk/api/bundler'

const stripContracts = {
  name: 'strip-contracts',
  enforce: 'pre', // see original sources, ahead of other transforms
  apply: 'build', // dev-server modules stay untouched, for debuggability
  transform(code: string, id: string, options?: { ssr?: boolean }) {
    // SSR modules keep their freight — the server genuinely reads the schemas.
    if (options?.ssr === true || !isScannableId(id) || !code.includes('defineContract')) return null
    const stripped = stripContractFields(code)
    return stripped === code ? null : { code: stripped, map: null }
  },
}

export default defineConfig({ plugins: [stripContracts] })
```

```ts
// build.ts — Bun.build (esbuild is the same shape; read the file with
// node:fs/promises' readFile). Add it to the browser build only.
import { stripContractFields } from '@amritk/api/bundler'

const stripContracts = {
  name: 'strip-contracts',
  setup(build: Bun.PluginBuilder) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async ({ path }) => {
      const source = await Bun.file(path).text()
      if (!source.includes('defineContract')) return undefined
      const stripped = stripContractFields(source)
      return stripped === source ? undefined : { contents: stripped, loader: path.endsWith('x') ? 'tsx' : 'ts' }
    })
  },
}

await Bun.build({ entrypoints: ['./src/client.ts'], target: 'browser', plugins: [stripContracts] })
```

```js
// strip-contracts-loader.mjs — rspack and webpack; the package is ESM-only,
// so the loader is too (both support ESM loaders).
import { stripContractFields } from '@amritk/api/bundler'

export default function stripContractsLoader(source) {
  return source.includes('defineContract') ? stripContractFields(source) : source
}

// rspack.config.mjs — scope it to the contracts you want slimmed
// module: { rules: [{ test: /\.[cm]?[jt]sx?$/, include: /contracts/, use: ['./strip-contracts-loader.mjs'] }] }
```

The strip is line-preserving — removed spans keep their newlines — so
downstream sourcemaps stay line-accurate, and returning the source unchanged
lets the bundler keep the original code and map.

##### Or strip once, at publish time

When contracts live in their own package that both the server and the
frontend import, the strip can run in *that* package's build instead of in
every app downstream — no bundler wiring at all for consumers, whatever they
build with. Emit two artifacts from one source, and split them with
`exports`:

```ts
// scripts/build-client.ts — run after tsc has written dist/
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'
import { stripContractFields } from '@amritk/api/bundler'

for (const file of await readdir('dist', { recursive: true })) {
  if (!file.endsWith('.js')) continue
  const source = stripContractFields(await readFile(join('dist', file), 'utf8'))
  // Reprint to drop the JSDoc tsc copied into the JS — see below.
  const { code } = transformSync(source, { loader: 'js', format: 'esm' })
  const out = join('dist-client', file)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, code)
}
```

```jsonc
// package.json — the server gets the schemas, the browser gets the slim copy
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./client": { "types": "./dist/index.d.ts", "default": "./dist-client/index.js" }
}
```

Both entries point at the **same** `.d.ts`, which is the part worth
understanding. Declarations are generated from the original source, so they
carry the full types *and* the JSDoc you wrote above each contract — hover,
autocomplete, and `ResponseBodyOf<…>` are identical on both entries, and only
the shipped values differ. Editors and `tsc` never see the strip. That is the
same trade the bundler hook makes; it just happens once, in the package that
owns the contracts.

Running over emitted JS rather than TypeScript sources is the more reliable
order, too: `defineContract` survives compilation intact (it is an identity
function, and tsc keeps the call), while the `as const` and `satisfies`
suffixes that make the scanner bail on a source file are already gone by
then.

That is also why the script reprints through esbuild. The strip rewrites
contract literals and never touches comments, and tsc copies every JSDoc
block into the `.js` it emits — so without that step the doc comment above
each contract ships to the browser, where it is dead weight the docs in the
`.d.ts` already cover. A consumer's production minifier would drop it, but
there is no reason to put it in the package. **Do not reach for tsc's
`removeComments` instead:** it strips JSDoc from the declaration files too,
which is precisely the hover help this layout exists to keep. Comments out of
the values, comments kept in the types.

The transform is deliberately conservative: call sites it cannot parse with
certainty (spreads, computed keys, explicit type arguments, aliased imports
of `defineContract`) are left byte-for-byte untouched, and unknown contract
fields are kept — the failure mode is a bigger bundle, never a broken one.

Per-operation `security` is **not** stripped. `createClient` does not read it
either, but an app plausibly does — attach a bearer token only where a scheme
is declared, skip a call that will certainly 401, hide a control for a scope
the session lacks — and a requirement is tens of bytes against the hundreds a
request schema costs. Everything else on the list is inert in a browser.

Three caveats. First, the strip assumes the browser only calls contracts
through `createClient`. If your app itself reads contract schemas at runtime
— client-side form validation against `contract.request.body`, in-browser
OpenAPI rendering — those modules must keep their freight: filter them out in
the hook, or leave the strip off. Second, only direct
`defineContract({ ... })` identifier calls are rewritten; a renamed import
or a wrapper function keeps its call sites intact (and its bytes). Third,
this is a size optimization and nothing more — it is not the way to keep a
`node:*` built-in out of a browser bundle, because bundlers resolve modules
before they eliminate them. Import contracts from `@amritk/api/client`
instead; that graph is guaranteed node-free.

Measured on a realistic widget consumer — three JSON-only contracts with
static paths, bundled with `Bun.build` (`target: 'browser'`, minified;
enforced by `src/bundler/strip-contract-fields.bundle.test.ts`, which bundles
through the `Bun.build` wiring above):

| Bundle                                | minified | gzip    |
| ------------------------------------- | -------- | ------- |
| 0.3.0 client (everything built in)    | 3.6 kB   | 1.7 kB  |
| 0.4.0 client, no strip                | 3.7 kB   | 1.7 kB  |
| 0.4.0 client + strip                  | 2.7 kB   | 1.4 kB  |
| contract data alone, before → after   | 1.3 kB → 0.31 kB | 0.57 kB → 0.19 kB |

The contract-data row is the one that scales: the strip removes ~75% of
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
| `formats` | — | String `format`s to assert: `'all'`, or a list like `['uuid', 'email']`. Off by default — see [String formats](#string-formats). |
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
  JSON; `bodyType: 'form'`, `'multipart'`, `'text'`, and `'bytes'` switch it
  (see below). A JSON body that fails to parse is a `400 { error:
  'invalid_json' }`; a form/multipart body that fails to parse is a `400 {
  error: 'invalid_body' }`.
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

### String formats

`format` is an **annotation** in JSON Schema, and both Ajv and
`@amritk/runtime-validators` make asserting it opt-in. The api follows suit: by
default a param declared `{ type: 'string', format: 'uuid' }` documents itself as
a UUID in the OpenAPI output and accepts any string at runtime.

Pass `formats` to assert them:

```ts
// Every built-in format: uuid, email, date-time, date, time, duration, uri,
// uri-reference, uri-template, hostname, idn-hostname, ipv4, ipv6,
// json-pointer, relative-json-pointer, regex, and the idn-/iri- variants.
const api = createApi({ routes, formats: 'all' })

// Or only the ones you rely on, leaving the rest as documentation.
const api = createApi({ routes, formats: ['uuid', 'email'] })
```

A violation is an ordinary `400 { error: 'validation_failed' }` alongside every
other constraint. Format checks are pragmatic regexes rather than RFC-perfect
parsers — they reject obviously-bad input; treat them as a first gate, not as
proof a value is routable or deliverable.

Pass the same value to `compileToModule({ formats })` so the compiled module and
the development server agree — a schema carrying `format` then leaves the
inlinable subset and is checked by the interpreter, which owns the regexes.
`formats` is ignored when you supply your own `compile`, since that replaces the
engine it configures.

### Branded IDs (nominal types for params)

Path/query params arrive as plain `string` / `number`, so nothing stops you from
passing a `userId` where an `orderId` is expected. Add an `x-mjst` **brand** to
the param schema and mjst intersects a unique nominal marker onto the inferred
type — the runtime still validates the plain base type, but the handler (and the
derived typed client) see a distinct branded id, the same protection Drizzle's
`.$type<UserId>()` gives a column:

```ts
const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid', 'x-mjst': { brand: 'UserId' } } },
      required: ['id'],
    },
  },
  responses: { 200: { body: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  handler: ({ params }) => {
    params.id // (string & { readonly __brand: 'UserId' }) — not a plain string
    return { status: 200, body: { id: params.id } }
  },
})
```

`params.id` is now a `UserId`, so `getOrder(params.id)` is a compile error unless
`getOrder` takes a `UserId`. The brand is **type-level only** — it adds no runtime
check beyond the base type, and the `format: 'uuid'` next to it is an annotation
until you opt in with [`formats`](#string-formats). Keep the schema
literal (inline or `as const`) so the brand survives inference, and use the same
brand shape (`{ readonly __brand: 'UserId' }`) for your app-side id type — define
it to match, rather than expecting mjst to reuse Drizzle's own brand symbol. See
[the `x-mjst` extension](../adapters/README.md#nominal-brands) for the full
reference.

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

### Streaming responses: documenting each item

A raw `contentType` says what the stream *is*; OpenAPI 3.2's `itemSchema` says
what each item in it looks like. Declare it on the response contract beside
`contentType` and it lands in the document next to `schema`:

```ts
import { sseItemSchema, sseStream } from '@amritk/api'

const tokens = defineRoute({
  method: 'get',
  path: '/chat/{id}/stream',
  request: { params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  responses: {
    200: {
      contentType: 'text/event-stream',
      // One SSE event, not the whole stream.
      itemSchema: sseItemSchema({ type: 'string' }, { event: 'token' }),
    },
  },
  handler: ({ request }) => ({ status: 200, body: sseStream(stream(), { signal: request.signal }) }),
})
```

The sequential media types OpenAPI recognizes are `text/event-stream`,
`application/jsonl`, `application/json-seq`, and `multipart/mixed`. For the
JSON-lines family the item is your record, so pass the schema directly
(`itemSchema: recordSchema`). For SSE the item is the **event envelope** —
`{ event, id, data, retry }` — with your payload inside `data`, which is what
`sseItemSchema` builds so you do not hand-write the wrapper at every route.

`itemSchema` is documentation only, exactly like a `body` schema on a raw
status: adapters pass the stream through untouched, so nothing here is
validated at runtime. It does take part in `components.schemas` hoisting, so a
titled event schema shared across routes appears once and is `$ref`erenced.

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

### Raw text and binary bodies

`bodyType: 'text'` and `'bytes'` skip parsing entirely: the body is validated
verbatim against the schema and handed to the handler as a `string` (decoded)
or a `Uint8Array` — a `text/csv` upload or a binary blob that still rides the
typed contract and the typed client, no hand-rolled `fetch` required. The 415
check is lenient (any `text/*` for text, any media type for bytes), so the
schema is the real gate.

```ts
const importCsv = defineContract({
  method: 'post',
  path: '/import',
  // { type: 'string' } for text; {} accepts any bytes.
  request: { body: { type: 'string', minLength: 1 }, bodyType: 'text' },
  responses: { 200: { body: { type: 'object', properties: { rows: { type: 'integer' } }, required: ['rows'] } } },
})

// server: the handler receives the raw string
implementRoute(importCsv, ({ body }) => ({ status: 200, body: { rows: body.split('\n').length } }))

// client: the body goes on the wire unchanged. text/bytes are built in — no
// serializer to register. A default content type is stamped only when nothing
// else set one, so override it per call for a specific media type.
await client.importCsv({ body: csvText, headers: { 'content-type': 'text/csv' } })
```

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

### Returning a raw `Response` (escape hatch)

A `contentType` status keeps the reply typed and documented while letting the
body be raw. When you instead need full control of the *entire* response —
status, headers, and body all outside the contract — a handler may return
`raw(response)`. The adapters send the wrapped response verbatim (the fetch
adapter returns it as-is, the Node adapter streams it out), still running the
`onResponse` decorators, and strip its body for HEAD like any other reply:

```ts
import { raw } from '@amritk/api'

const proxy = defineRoute({
  method: 'get',
  path: '/legacy',
  responses: { 200: { body: legacySchema } },
  // Reuse an existing Response-building helper (or an upstream fetch) unchanged.
  handler: async ({ request }) => raw(await fetch(new URL(request.raw as Request), { redirect: 'manual' })),
})
```

This is a deliberate escape hatch: a `raw` reply skips response validation
entirely (there is no framework-level body to check), so the status it carries
need not appear in `responses`. Reach for it when porting handlers that already
build `Response` objects, or when proxying an upstream response; prefer a typed
`{ status, body }` reply — or a `contentType` status for raw bodies —
everywhere else, so the contract stays the source of truth.

The `raw()` wrapper (`{ raw: Response }`) is not just ergonomics. A bare
`Response` in the handler's return union carries `status: number`, which matches
every declared status and so forces TypeScript to check the reply against
`Response` too — making an ordinary reply whose own status is a union of
declared statuses fail to compile, with a misleading complaint about the status:

```ts
// `embed.status` is `502 | 503`, and the contract declares both.
if (!embed.ok) return { status: embed.status, body: { error: embed.error } }
```

`raw` carries no `status`, so replies like that infer normally. Returning a bare
`Response` is no longer accepted as of 0.10.0 — wrap it in `raw()`.

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

When the API is mounted on another server that reads the body first, that
server's own limit can trip before this one. Those foreign body-limit errors
are recognized too, so they answer 413 rather than a generic 500: Fastify's
`FST_ERR_CTP_BODY_TOO_LARGE` (its `bodyLimit`), Express's
`body-parser`/`raw-body` `entity.too.large`, and any thrown HTTP error whose
`statusCode`/`status` is 413.

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

### Built-in security hooks

Rather than hand-roll the gates above, the package ships the common security
middleware as hook factories — the `helmet` / `secure-headers`, `cors`,
`rate-limit`, and CSRF features every framework in the ecosystem provides,
expressed over the same `onRequest`/`onResponse`/`locals` seams so they work
identically under the runtime and the compiled engine.

```ts
import {
  createCors,
  createCsrf,
  createRateLimit,
  createSecurityHeaders,
  toFetchHandler,
} from '@amritk/api'

const cors = createCors({ origin: (o) => o, credentials: true })
const csrf = createCsrf()
const limit = createRateLimit({ limit: 100, windowMs: 60_000 })

const handler = toFetchHandler(api, {
  onRequest: [cors.onRequest, limit.onRequest, csrf.onRequest],
  onResponse: [cors.onResponse, limit.onResponse, csrf.onResponse, createSecurityHeaders()],
})
```

**`createSecurityHeaders(options?)`** — an `onResponse` decorator that stamps
the browser-hardening headers (`x-content-type-options: nosniff`,
`x-frame-options: SAMEORIGIN`, `referrer-policy: no-referrer`, the
cross-origin isolation trio, …) only when the handler didn't already set them.
**HSTS and CSP default off** on purpose: `strict-transport-security` on a bare
IP or a plain-HTTP dev origin locks browsers out, and no single CSP fits every
app — opt into both explicitly (`strictTransportSecurity: true`,
`contentSecurityPolicy: "…"`) for a production HTTPS deployment. Any field
takes `false` to omit or a string to override.

**`createCors(options)`** — preflight answerer (`onRequest`) plus allow/expose
stamper (`onResponse`), applied to *every* response including 404s and gate
short-circuits, since a browser drops any reply without the allow-origin
header. It **throws at setup** on the spec-forbidden `origin: '*'` +
`credentials: true` pair. A function origin (`(o) => o`) is trusted as
written — reflecting *every* origin with `credentials: true` turns any site
into a trusted caller, so validate the origin inside the function rather than
echoing it blindly.

**`createRateLimit(options)`** — counts each request against a key and
short-circuits over-limit ones with a `429` carrying `Retry-After` and the
`RateLimit-*` headers; under the limit it stamps those headers via `locals`.
The default in-process `memoryRateLimitStore()` is single-instance and
memory-bounded; pass a shared `store` (Redis, a Durable Object) for a fleet.

> **Keying is a security decision.** The default key is the client IP read
> from `cf-connecting-ip` / `x-real-ip` / the first `x-forwarded-for` hop —
> **all client-supplied and spoofable**. An attacker rotating the header gets
> a fresh bucket per request, defeating the limit. Rely on the default only
> when a trusted proxy *overwrites* these headers and the origin isn't
> reachable around it. For a security throttle (login / brute-force), pass a
> `key` that reads a proxy-verified IP (the rightmost untrusted
> `x-forwarded-for` hop for your topology) or an authenticated user id from
> `locals`.

**`createCsrf(options?)`** — stateless double-submit-cookie CSRF (the defense
Rails, Laravel, and Hono ship). The gate rejects an unsafe-method request
whose `x-csrf-token` header doesn't match its `csrf_token` cookie with a `403`
(empty/missing tokens are always rejected — a blank pair never satisfies the
check); the decorator seeds the cookie on any response that lacks one. The
cookie defaults to `Path=/; SameSite=Lax; Secure` and is intentionally **not**
`HttpOnly` — the pattern needs page scripts to read and echo it. Drop `Secure`
via `cookieAttributes` only for a plain-HTTP dev origin. Use `exempt` to skip
bearer-token API paths, where CSRF doesn't apply — **`exemptBearer`** is that
predicate written the safe way (see [native apps](#native-apps-magic-link-without-a-browsers-cookie-jar)
for why keying on `authorization` is sound and keying on a missing `Origin` is a
bypass). On the client, pair it with
**`createCsrfHeader()`** — a `headers` provider for `createClient` that reads
the `csrf_token` cookie and echoes it in `x-csrf-token`:

```ts
import { createClient, createCsrfHeader } from '@amritk/api/client'

const client = createClient(contracts, 'https://api.example.com', {
  fetchOptions: { credentials: 'include' },
  headers: createCsrfHeader(),
})
```

### Signed cookies

**`signCookie` / `unsignCookie` / `createSignedCookies`** sign a value with
HMAC-SHA256 over the Web Crypto API (so the same code runs on Workers, Bun,
Deno, and Node ≥ 20). A signed value is `<value>.<base64url-hmac>`; tampering
with either half fails verification, which runs through the constant-time
`crypto.subtle.verify`. This is **integrity, not secrecy** — the value stays
readable, so sign a session id and keep the session server-side; never put a
secret in it.

```ts
import { createSignedCookies } from '@amritk/api'

const cookies = createSignedCookies(env.COOKIE_SECRET)
const setCookie = `sid=${await cookies.sign(sessionId)}; HttpOnly; Secure; SameSite=Lax`
const sessionId = await cookies.unsign(parsedCookie) // undefined if tampered
// Rotate by unsigning against the current secret first, then older ones.
```

### Framework-parity helpers

The gates and decorators above are the security half of what a batteries-included
framework ships. The rest is here too, each one composing through an existing
seam (`mounts`, `onRequest`/`onResponse`, `locals`, the raw reply) rather than
changing the request pipeline — so nothing costs anything until you wire it in:

| Export | What it does | Seam |
|:--|:--|:--|
| `createDocs(options?)` · `docsHtml(options?)` | Interactive Scalar API reference page next to `openapi.json`. The bundle loads from a CDN at view time — pin or self-host it via `cdn` under a strict CSP. `docsHtml` returns the markup alone for apps that serve their own page. | `mounts` |
| `createHealth(options?)` | Health/readiness endpoint. Runs every probe concurrently and answers `200 {status:'ok'}` or `503 {status:'error'}` listing which are down — a throwing probe counts as down. Omit `checks` for a bare liveness endpoint. | `mounts` |
| `createETag(options?)` | Strong entity tags plus conditional-GET: hashes a safe-method `200` body, sets `ETag`, and answers `304` on a matching `if-none-match`. Buffers the body to hash it, so it is opt-in and never touches a streaming reply. | `onResponse` |
| `createCompression(options?)` | gzip/deflate over the platform `CompressionStream` — negotiates `accept-encoding` with RFC 9110 `q`-weights, sets `content-encoding`, drops the stale `content-length`, appends to `vary`, weakens a strong `etag` (the encoded bytes are a different representation), and leaves partial (`206`/`content-range`) responses alone. | `onResponse` |
| `createRequestId(options?)` · `getRequestId(locals)` | Correlation ids: adopt a trusted inbound header or generate one, write it to `locals` for handlers/`observe`, and echo it on the response. | `onRequest` + `onResponse` |
| `versionRoutes(prefix, routes)` | URI-prefix versioning (`/v1`, `/v2`) — returns copies of the contracts with the prefix prepended to each `path`, so the prefix flows into OpenAPI and typed clients too. | route list |
| `withTimeout(ms, handler, onTimeout)` | Wall-clock deadline on one handler; past `ms`, `onTimeout` produces the reply (a status the route declares) and the slow result is discarded. Bounds pipeline occupancy, not work already handed to the platform. | route `handler` |
| `runAfterResponse(executionContext, task, onError?)` · `createBackground(executionContext, onError?)` | Work that outlives the response — registered through `waitUntil` where the platform has it (Workers), detached elsewhere. A rejected task goes to `onError` instead of becoming an unhandled rejection. | `executionContext` |
| `sseStream(source, options?)` · `formatSse(event)` | Server-Sent Events as a streaming body for a raw `contentType` route. | `contentType` reply |
| `sseItemSchema(dataSchema, options?)` | Builds the `itemSchema` for a `text/event-stream` response — wraps a payload schema in the SSE event envelope. | response contract |
| `defineMessages(contract)` · `bindMessages(contract, socket, options?)` · `connectMessages(contract, options)` | Typed, validated messages over a realtime connection — one declaration, both ends. | after the 101 |
| `streamMultipart(body, contentType, options?)` · `multipartBoundary(contentType)` | Async-iterate multipart parts off the raw body stream instead of buffering the whole upload. | `request.raw` |
| `negotiateMediaType(accept, offers)` · `parseAccept(header)` | Server-driven content negotiation with RFC 9110 media-range specificity and `q=0` handling. | handler |
| `createStatic(options)` · `resolveStaticPath(options)` | Static files from a document root, with content types, `etag`/`last-modified`, conditional `304`s, and HEAD. Path resolution rejects the percent-encoded traversals that survive client normalization, and denies dotfiles by default. Reading is injected, since no one filesystem call works on Bun, Node, and Workers alike. | `onRequest` |

```ts
import { createCompression, createDocs, createETag, createHealth, createRequestId } from '@amritk/api'

const requestId = createRequestId()

const handler = toFetchHandler(api, {
  mounts: {
    '/docs': createDocs(), //            GET /docs   → interactive reference
    '/healthz': createHealth(), //       liveness
    '/readyz': createHealth({ checks: [{ name: 'db', check: () => db.ping() }] }),
  },
  onRequest: [requestId.onRequest],
  onResponse: [requestId.onResponse, createETag(), createCompression()],
})
```

#### Static files

`createStatic` needs a reader because there is no filesystem call that works on
Bun, Node, and Workers alike, and importing `node:fs` to serve the first would
break the Workers build for everyone. A missing file must come back as
`undefined` rather than a thrown `ENOENT` — a throw is an error the pipeline
reports as a 500, which is not what "not found" means.

```ts
import { createStatic, type StaticReader } from '@amritk/api'

const read: StaticReader = async (path) => {
  const file = Bun.file(path)
  return (await file.exists())
    ? { body: file.stream(), size: file.size, type: file.type, lastModified: file.lastModified }
    : undefined
}

const handler = toFetchHandler(api, {
  onRequest: [createStatic({ root: './public', prefix: '/assets', read })],
  onResponse: [createSecurityHeaders()],
})
```

Anything it does not serve returns `undefined` and falls through to routing —
a path outside the prefix, an unsafe method, a missing file — so a client sees
the API's own 404 envelope rather than a second error shape, and a request that
is not for a file allocates no promise.

The path resolution is the part worth reading the source of. Serving files
next to an API is one route today (`/assets/{path+}` plus a raw reply), and
that route is wrong in a way its own tests will not catch: the tail parameter
decodes each segment individually, so `/assets/%2e%2e%2f%2e%2e%2fetc/passwd`
arrives at the handler as `../../etc/passwd`. A literal `../` never gets that
far — clients and proxies normalize it away — so the obvious
`path.includes('..')` guard passes every test anyone writes for it and stops
nothing. `resolveStaticPath` splits first, decodes each segment second, and
judges third, rejecting anything that after decoding means more than one level
down; containment is by construction rather than by comparing a resolved path
against the root afterwards. Dotfiles are denied by default, since a document
root routinely sits beside `.env` and `.git`.

Two limits, stated rather than half-implemented: `Range` is not handled, so a
media file served through this cannot be seeked (put a CDN or the platform's
own file serving in front of video); and a symlink inside the root pointing
outside it is invisible here, since seeing it needs a `realpath` the reader
seam does not expose.

### Realtime: WebTransport with a WebSocket fallback

`connectRealtime` prefers WebTransport and drops down to WebSocket when
WebTransport is unavailable, refused, or hung. Both arms hand back the same
message channel, so nothing above it branches on which one won — a fallback the
caller has to branch on is not a fallback, it is two code paths, one of which
only runs on the networks the developer does not have.

```ts
import { connectRealtime } from '@amritk/api/client'

const connection = await connectRealtime({
  // One endpoint. The scheme each transport needs is derived from the other,
  // so both attempts always address the same place.
  url: 'https://api.example.com/ws/lobby',
  connectTimeoutMs: 3000,
  onFallback: (transport, reason) => metrics.increment(`realtime.fallback.${transport}`),
})

connection.send('hello')
for await (const message of connection.messages) render(message)
```

The deadline is what makes the fallback work on the networks that need it. A
WebTransport attempt where UDP is silently dropped — corporate egress filters,
some mobile carriers, a fair number of hotel networks — does not fail. It
hangs, because QUIC cannot tell a blackhole from a slow path, and without a
bound the fallback never runs and the user simply waits. `onFallback` exists
for the same reason in reverse: a silent fallback hides exactly the signal you
want, and "WebTransport worked in testing and fails for 40% of production" is
invisible until someone reports it.

Pin one transport with `transports: ['websocket']`, and reach the live
`WebTransport` or `WebSocket` through `connection.session` when you need
datagrams, extra streams, or `bufferedAmount`.

#### What the server side actually is

Being precise about this matters, because the client half above is portable and
the server half is not:

| Runtime | WebSocket | WebTransport |
|:--|:--|:--|
| Bun 1.4 | `upgradeWebSocket(server, request)` | none |
| Cloudflare Workers | `acceptWebSocket()` | none — workerd ships no QUIC/HTTP-3 implementation |
| Deno | `raw(Deno.upgradeWebSocket(request).response)` | `Deno.upgradeWebTransport` exists, but on a raw QUIC listener rather than `Deno.serve` |
| Node | not through this adapter — upgrades ride the server's `'upgrade'` event | none stable |

**This package cannot serve WebTransport, and that is a deliberate stop rather
than a gap to be filled.** It needs a QUIC stack, no runtime the adapters
target exposes one through a fetch handler, and supplying one would mean a
native addon dependency — which would cost the Workers and React Native support
that staying dependency-light buys. So today the WebTransport arm connects to a
separate quic-go, wtransport, or `@fails-components/webtransport` process
speaking the framing in `realtime-framing` (a kind byte, a 32-bit big-endian
length, the payload — about ten lines to reproduce), and the WebSocket arm is
what `upgradeWebSocket` serves. The negotiation is written now so that the day
a runtime does ship server WebTransport, clients already prefer it and no
application code changes.

#### Serving the WebSocket arm

The handshake is an ordinary routed request, so the contract still applies to
it: path params are validated and coerced, guards run, and `onRequest` gates
(rate limits, origin checks) have already had their say. An upgrade that
skipped the contract would be a hole in every policy the app configured.

```ts
import { createApi, routeFactory, toFetchHandler, upgradeWebSocket } from '@amritk/api'

const route = routeFactory<{ server: Bun.Server }>()

const chat = route({
  method: 'get',
  path: '/ws/{room}',
  request: { params: { type: 'object', properties: { room: { type: 'string' } }, required: ['room'] } },
  responses: { 426: {} },
  handler: ({ params, request, context }) =>
    // `data` is how validated params and the resolved session reach the
    // `websocket` handlers, which run outside the request and see neither.
    upgradeWebSocket(context.server, request, { data: { room: params.room } }) ?? { status: 426 as const },
})

const api = createApi({ routes: [chat], info, context: ({ env }) => ({ server: env as Bun.Server }) })
const handler = toFetchHandler(api)

Bun.serve({
  fetch: (request, server) => handler(request, server), // Bun passes the server as `env`
  websocket: {
    open: (ws) => ws.send(`joined:${(ws.data as { room: string }).room}`),
    message: (ws, message) => ws.send(`echo:${message}`),
  },
})
```

The `?? { status: 426 }` is not a formality. Bun's HTTP/3 listener does not
implement RFC 9220 WebSocket bootstrapping, so `server.upgrade()` returns
`false` for every request that arrived over QUIC — with `http3: true` set, the
*same route* succeeds over TCP and is refused over UDP, decided by which
transport the client happened to pick. Requiring the caller to supply the
refusal keeps that outcome in the contract and in the OpenAPI document instead
of collapsing it to a 500. Measured against Bun 1.4: `101` over TCP, the
declared `426` over QUIC.

Do not bother pairing that 426 with the `upgrade:` and `connection:` headers
RFC 9110 suggests. Both are connection-specific headers that HTTP/2 and HTTP/3
forbid (RFC 9114 §4.2), so an H3 listener strips them on the way out — the
client learns nothing in exactly the case they were added for. The status is
the portable signal, and `connectRealtime` treats any non-101 as "fall back".

On Workers, `acceptWebSocket()` replaces the upgrade call and hides two things
the raw API gets wrong for callers: `WebSocketPair` is an object keyed `0` and
`1` rather than an array, and a missed `server.accept()` produces a connection
that opens and then silently drops every message.

```ts
import { acceptWebSocket } from '@amritk/api'

handler: ({ params }) => {
  const { socket, reply } = acceptWebSocket()
  socket.addEventListener('message', (event) => socket.send(`${params.room}: ${event.data}`))
  return reply
}
```

#### Message contracts: typing what flows after the 101

The upgrade is contract-covered — params validated, guards run, the 426
declared — but the contract stops at the 101: `socket.send` takes anything and
frames arrive as `string | Uint8Array`. A `messages` contract covers the rest
of the conversation, and one declaration drives both ends.

```ts
import { defineMessages } from '@amritk/api'

export const chatMessages = defineMessages({
  clientToServer: {
    say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  serverToClient: {
    said: {
      type: 'object',
      properties: { from: { type: 'string' }, text: { type: 'string' } },
      required: ['from', 'text'],
    },
  },
})
```

Directions are named for their endpoints, not for the reader. `send`/`receive`
and `inbound`/`outbound` inverts depending on which side is reading it, and the
whole point is that both sides read the same declaration. (AsyncAPI renamed its
`publish`/`subscribe` pair in 3.0 over exactly this.)

Each message is identified by a **discriminator** — `type` unless you set
`discriminator`. Your schema describes the **payload**, and the discriminator is
not part of it: the tag is read to pick the message, then removed before the
payload is validated. So `additionalProperties: false` keeps working, and so do
composed schemas — an `allOf` branch or a `$ref` target that closes itself never
sees a property it did not declare. A schema that declares the discriminator
itself is refused at setup time, since it could only ever fail.

**Server** — `bindMessages` wraps any runtime's socket:

```ts
import { acceptWebSocket, bindMessages } from '@amritk/api'

const { socket, reply } = acceptWebSocket()
const channel = bindMessages(chatMessages, socket)

// Drive the loop without awaiting it: nothing arrives until the client sees
// the 101, so awaiting here would hold back the very response that starts the
// conversation, and the connection would deadlock.
void (async () => {
  for await (const message of channel.messages) {
    // message is { type: 'say'; text: string } — narrowed, already validated
    if (message.type === 'say') channel.send({ type: 'said', from: user, text: message.text })
  }
})()

return reply
```

On Workers and Deno the socket is an `EventTarget` and frames are wired up for
you. Bun's message handlers live outside the request on `Bun.serve({ websocket })`
and see only `ws.data`. The socket does not exist until the upgrade completes,
so build the channel in `open` and stash it there for the other handlers —
`upgradeWebSocket(server, request, { data })` seeds `ws.data` with the
request-scoped values (validated params, the resolved session), but it cannot
carry the channel itself, because there is no socket to bind yet:

```ts
Bun.serve({
  websocket: {
    open: (ws) => {
      ws.data.channel = bindMessages(chatMessages, ws)
      void (async () => {
        for await (const message of ws.data.channel.messages) handle(ws.data.room, message)
      })()
    },
    message: (ws, raw) => ws.data.channel.accept(raw),
    close: (ws) => ws.data.channel.end(),
  },
})
```

**Client** — `connectMessages` is the mirror image, over `connectRealtime`:

```ts
import { connectMessages } from '@amritk/api/client'

const channel = await connectMessages(chatMessages, { url: 'https://api.example.com/ws/lobby' })
channel.send({ type: 'say', text: 'hello' })
for await (const message of channel.messages) {
  if (message.type === 'said') render(message.from, message.text)
}
```

The directions swap and nothing else does: the browser's `send` is exactly the
server's `messages`, checked against the same schema.

**When a frame breaks the contract** — not JSON, no discriminator, an unknown
name, or a payload failing its schema — the default is to close with `4007`
carrying a one-line reason, truncated to RFC 6455's 123-byte budget on a
character boundary. (RFC 6455's own "invalid frame payload data" code is 1007,
but JavaScript may not send it: the WHATWG `close()` algorithm accepts only
1000 and the private 3000–4999 range, so a 1xxx code throws on Workers and
Deno. `4007` keeps the last three digits inside the range every runtime
permits.) `onInvalid` sees every refusal and can override:

```ts
bindMessages(chatMessages, socket, {
  onInvalid: (failure) => {
    metrics.increment(`ws.invalid.${failure.reason}`) // 'malformed' | 'binary' | 'unknown-type' | 'invalid-payload'
    return 'ignore' // or 'close', or nothing for the default
  },
})
```

Binary frames are the one refusal that defaults to `ignore` rather than
`close`: nothing in a JSON contract describes them, but a peer may legitimately
be sending them alongside contract messages. They arrive on `channel.binary`,
on both ends. Not on `channel.connection.messages`: the client channel drains
that iterator to feed its own and the queue underneath does not tee, so
anything left there would never be read.

Outbound messages are typed at compile time and validated only under
`validateOutbound`, the same trade `validateResponses` makes for handler
replies.

A contract can also be attached to the route it belongs to
(`defineRoute({ ..., messages: chatMessages })`), which colocates it and carries
it to any consumer importing the contract. The field is optional, so reading it
back off a route gives `… | undefined` — pass the standalone constant to
`bindMessages` / `connectMessages` and the types come through unchanged.

**What this does not do:** there is no OpenAPI representation. OpenAPI has no
vocabulary for a bidirectional message union, so `messages` never appears in
the document — the contract stays the single source of truth, and an AsyncAPI
projection remains a separate question. See the plan doc for why a parallel
channel DSL was set aside.

### Client-side auth refresh

Three helpers cover the three token models, all plugging into
`createClient({ headers, fetch })`:

**`createTokenRefresh(options)`** — the **bearer-token** model. It holds a
single-flighted token and renews it on the token's own clock: a call that
finds the token expired blocks on one shared `refresh` (no thundering herd),
and a token inside its `refreshBefore` window renews in the background while
the current call rides the still-valid token. JWTs are zero-config — return
the string from `refresh` and its `exp` is decoded by
**`decodeJwtExpiry`** (signature deliberately unverified; it's read only to
schedule refresh, and the server still verifies every token). It does **not**
react to 401s — call `invalidate()` from your 401 handling or on logout to
force the next call to refresh. `invalidate()` also wins a race against an
in-flight background refresh, so a logout can't be silently undone by a
renewal already on the wire.

```ts
import { createClient, createTokenRefresh } from '@amritk/api/client'

const auth = createTokenRefresh({
  refresh: async () => (await fetch('/auth/refresh').then((r) => r.json())).accessToken, // a JWT
})
const client = createClient(contracts, 'https://api.example.com', { headers: auth.headers })
// on logout: auth.invalidate(); on teardown: auth.dispose()
```

**`createRefreshFetch(options)`** — the **HttpOnly-cookie** model, where the
browser holds no token and only triggers a server-side renewal. It wraps a
fetch so a `401` (override `shouldRefresh`) runs a single-flighted `refresh`
and replays the original request exactly once — no retry loop, no refresh
stampede. Because it renews on a real server 401, it also covers
early-revocation that a pure expiry clock can't see.

```ts
import { createClient, createCsrfHeader, createRefreshFetch } from '@amritk/api/client'

const authFetch = createRefreshFetch({
  refresh: () => fetch('/auth/refresh', { method: 'POST', credentials: 'include' }),
})
const client = createClient(contracts, 'https://api.example.com', {
  fetch: authFetch,
  fetchOptions: { credentials: 'include' },
  headers: createCsrfHeader(),
})
```

**`createBearerSession(options)`** — the **stored-session-token** model, for
clients with no cookie jar at all: [native apps](#native-apps-magic-link-without-a-browsers-cookie-jar),
where a magic-link sign-in hands back a token rather than a `Set-Cookie` the
platform would keep and re-attach. It wraps a fetch and owns the round trip —
attaches the stored token, captures a newly issued one off any reply's
`set-auth-token`, and on a `401` either runs an optional `refresh` or clears the
token and fires `onExpired` so the app can route back to sign-in. Renewal is
usually nothing at all here: a server-held session (Better Auth's, say) extends
its own expiry when a request arrives and keeps the token stable, so sending it
is what keeps it alive. `storage` is the one
required option and is deliberately not defaulted: an in-memory fallback would
look like it worked until the app relaunched and every user was signed out.

```ts
import { createBearerSession, createClient } from '@amritk/api/client'

const session = createBearerSession({ storage, onExpired: () => router.replace('/sign-in') })
const client = createClient(contracts, 'https://api.example.com', { fetch: session.fetch })
```

It is a fetch wrapper rather than a `headers` provider because both halves of the
bearer model need to see responses — the rotated token arrives on one, and a
replay after renewal has to go out under the **new** token. That is the trap it
exists to close: `createRefreshFetch` can replay an untouched `RequestInit`
because the browser re-attaches the freshly `Set-Cookie`'d session itself, and
nothing does that for a bearer token.

Picking between the three: `createTokenRefresh` when the credential has its own
clock and a renewal endpoint (JWT access tokens), `createRefreshFetch` when the
browser holds an HttpOnly cookie and only triggers renewal, `createBearerSession`
when your client stores the session itself.

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

### Development: hot reloading

`@amritk/api/dev` turns the runtime engine into a hot-reloading dev server:
the process keeps its socket, its connections, and everything living outside
your route modules, while the route table, validators, and OpenAPI document
are rebuilt from the code on disk whenever it changes. No restart, no
`node --watch` losing your in-memory state between saves.

```ts
// dev.ts — bun dev.ts, node dev.js, deno run dev.ts
import { toFetchHandler } from '@amritk/api'
import { createHotApi, importFresh, watchPaths } from '@amritk/api/dev'

const api = await createHotApi({
  load: async () => {
    const routes = await importFresh<typeof import('./src/routes')>('./src/routes.ts')
    return { routes: Object.values(routes), validateResponses: true }
  },
  watch: watchPaths('src'),
})

Bun.serve({ port: 3000, fetch: toFetchHandler(api) })
// or: http.createServer(toNodeHandler(api)).listen(3000)
```

`api` is a normal `Api` — the same object `toFetchHandler` / `toNodeHandler` /
`createDocs` take — so it is wired in once and never mentioned again. Three
pieces make it up:

| Export | What it does |
|:---|:---|
| `createHotApi({ load, watch?, onReload?, onReloadError?, log? })` | The stable `Api` whose build is swapped underneath it. Adds `reload(changed?)`, `close()`, `generation()`, and `error()`. |
| `watchPaths(paths, { extensions?, ignore?, debounceMs? })` | Recursive filesystem watching, debounced into one batch per save. It is just the default `watch` seam — anything of the shape `(onChange) => dispose` fits, so a bundler's watcher or a test's manual trigger drops straight in. |
| `importFresh(specifier, { base?, graph?, root? })` | Re-imports a module the runtime has already cached, which is what lets `load` see new code. Resolves relative specifiers against `process.cwd()` by default. |

What it guarantees while you edit:

- **The swap is atomic.** A reload only takes over once the new build
  succeeded, and in-flight requests finish against the build they started on.
- **A broken edit does not take the server down.** The previous build keeps
  serving, the error is logged and kept on `api.error()`. Fix the file, save,
  and the next reload takes over.
- **A broken *first* build still binds the port** and answers `503
  {error:'not_loaded'}` with the reason, instead of exiting before you can
  curl it.
- **Reloads coalesce.** Edits landing mid-build share one follow-up pass, so
  a `git checkout` costs one extra build rather than one per file.

How far a reload reaches depends on the runtime. On Node (22.15+) it covers
the **whole local graph** — editing a handler three imports deep rebuilds the
API — via a `node:module` resolve hook, scoped to files under `root` so your
dependencies are never re-evaluated. Elsewhere (Bun, Deno, older Node) the
module named in `load` reloads but the modules *it* imports keep their
instances; `bun --hot` covers that case natively, so on Bun either run under
`--hot` **or** use `watchPaths`, not both — otherwise every save reloads
twice.

Modules that reload get **fresh instances**, so anything that must survive a
reload — a connection pool, an in-memory store — belongs outside them (on
`globalThis`, or in a module outside `root`). And keep this entry out of
production: every generation stays in memory, and `createApi`'s startup checks
(duplicate routes, unsecured routes) are worth failing a deploy over rather
than logging. Production is the compiled engine, next.

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
import { getProfile, getUser } from '../src/routes'

// routes.ts keeps individual named exports — the compiled module imports each by
// name — so the build step collects them into the record compileToModule wants.
const routes = { getProfile, getUser }
writeFileSync('src/api.compiled.ts', compileToModule({ routesImport: './routes', routes }))
```

```ts
// src/worker.ts — Cloudflare Workers entry
import compiled from './api.compiled'
export default compiled // { fetch }

// dev server instead: toFetchHandler(createApi({ routes: Object.values(routes), validateResponses: true }))
```

`Request` → `Response` through the whole stack — a fresh `Request` per
operation, exactly what a server runtime hands you — against the standard
Workers stack, on the same three routes, on all three runtimes this package
targets. Reproduce with `bun run bench:workerd`, `bun run bench:vs` (Node), or
`bun run bench:vs:bun`.

Every table below was re-measured together on one machine (Bun 1.3.11 /
Node 22, Linux x64, workerd 1.20260722), after the pipeline changes described
below. That machine is slower than the one earlier revisions of this table were
taken on — bare Hono reads ~148k ops/s on Node here against ~173k there — so
the absolute numbers sit lower across every column at once. Compare columns
within a table, not against a figure you remember.

Under **workerd**, the runtime `compileToModule` exists for, measured inside a
real isolate (Miniflare, one fresh isolate per cell) rather than in a stand-in
that shares its engine. Each cell is the median of five isolates, because
isolates differ from one another by more than trials within one isolate do:

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~104k ops/s ¹ | ~98k | ~93k | **~105k** |
| dynamic GET, params validated | ~93k ¹ | ~65k | ~69k | **~104k** |
| POST, body validated | **~31k** ¹ | ~25k | ~25k | ~29k |

Under **Node/V8** — the same engine workerd runs, without workerd around it:

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~148k ops/s ¹ | ~143k | ~109k | **~151k** |
| dynamic GET, params validated | **~123k** ¹ | ~58k | ~81k | **~123k** |
| POST, body validated | **~53k** ¹ | ~43k | ~36k | ~46k |

Under **Bun/JavaScriptCore**, where web-standard `Request`/`Response` objects
are far cheaper to build than undici's and more of the difference is the
framework rather than the runtime:

| case | hono (no validation) | hono + zod | runtime engine (dev) | compiled engine (prod) |
|:--|--:|--:|--:|--:|
| static GET | ~185k ops/s ¹ | ~159k | ~272k | **~349k** |
| dynamic GET, params validated | ~144k ¹ | ~61k | ~145k | **~245k** |
| POST, body validated | **~146k** ¹ | ~80k | ~100k | ~131k |

<sub>¹ hono-bare does no validation; every @amritk/api column validates, and
the runtime column validates responses too (`validateResponses: true`, the
development configuration). Every column is checked for the same status on
every case before it is timed.</sub>

Read the ratios, not the absolutes. Against the like-for-like column —
`hono + zod`, the other stack that actually validates — the compiled engine
leads every case on Bun (1.6–4.0×), Node (1.1–2.1×), and workerd (1.1–1.6×),
widest wherever params and query have to be coerced and checked. Against
*unvalidated* Hono it leads the GET cases on Bun (1.7–1.9×) and on workerd
(1.0–1.1×), matches on Node's, and trails on the POST case everywhere
(0.87–0.94×) — that case is dominated by reading and parsing the body, which
every column pays and none of the compiler's work removes. The runtime
(development) engine — no build step, response validation on — now lands level
with `hono + zod` under workerd (0.95–1.06×), well above it on Bun
(1.25–2.38×), and mixed on Node, where it trails on the static GET and the POST
but leads the dynamic one (0.76–1.40×).

**On the pauses this table used to warn about.** An earlier revision reported
that workerd stalled the `@amritk/api` columns far more often than Hono, and
guessed the cause was this engine allocating more per request. That guess was
wrong, and measuring it is what found the real defect. `bun run
bench:workerd:allocations` reads the isolate's heap over the inspector either
side of a run of exactly N requests and regresses the delta against N; on the
static GET the compiled engine allocated **852 bytes per request against bare
Hono's 1220**, and turned a batch of 2048 requests around *faster* than Hono.
It allocated less and ran quicker, then periodically got stopped — so volume
was never the story.

The cause was two allocations of the wrong *kind*, both ours. Both engines
built their per-request object with `signal: request.signal`, read eagerly;
on workerd that first touch materializes a host-backed `AbortSignal`, cheap in
bytes and expensive to collect, which Hono never creates at all. Deferring it
behind a getter fixed that and exposed the second: an *own* accessor pushes
the object out of V8's in-object slots, taking the compiled engine from 852 to
1276 bytes per request. Inheriting the getter from a shared prototype keeps
the deferral and gives the layout back. The compiled engine now allocates
**816 bytes per request and stalls on 0 of 60 batches**, matching both Hono
columns, where before it stalled on 5 and lost 29% of its wall clock to them.

The runtime engine had a second, unrelated cost: it ran the whole request
through an `async` pipeline even when nothing in it suspended. A route with no
declared body, no `refine`, no context factory, no guards, and a synchronous
handler never needs to yield, and the frame and promise were pure overhead.
`Api.handle` now returns `ApiResponse | Promise<ApiResponse>` and the pipeline
stays synchronous until something genuinely asynchronous appears. On the static
GET that took it from 2115 to 1510 bytes per request and from ~69k to ~93k
ops/s — from 0.80× bare Hono to level with it.

What that did *not* fix is the pause. The runtime engine's batch times under
workerd are still bimodal: a p95 around 3.3× its median, a discrete ~40 ms
event rather than a broad spread. Removing the async machinery did not move it
and neither did turning response validation off, so it is a major collection
driven by something still unaccounted for. The compiled engine — the production
path — does not show it, and its p95 sits within a few percent of its median.
That one is open work, and the medians above are what to plan against.

One more thing the measurements settled. The body read is the POST case's
dominant cost, and `bun run bench:workerd:body` compares four ways of doing it,
paired inside each round so machine drift cancels. Reading through workerd's
native `text()` and parsing in JS is worth 1.20–1.23× over the `arrayBuffer` +
`TextDecoder` route both engines take today; native `json()`, which is what
Hono uses, is worth only 1.11–1.12× — it loses to `text()` plus a JS parse.
Neither is free: the engines buffer bytes so that `readBody`, `readText`, and
`readBytes` all stay available on the same request, which is what a webhook
handler verifying an HMAC over the exact bytes needs, and a native read
consumes the body once. That trade is not made here.

The three runtimes disagree for a reason worth knowing. Building the `Request`
and `Response` objects is itself a large fixed cost on Node's undici, paid
identically by every column, which compresses that table toward the runtime's
floor; JavaScriptCore's are cheap enough that the same code shows its
differences plainly. So no single table is the whole picture: workerd is the
number to plan a Workers deployment against, Node the conservative
general-purpose one, and Bun the clearest view of what the engine itself
costs.

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

### Guards: authorize once, declare the outcome

A guard is an authorization check that runs **after validation and the context
factory, before the handler** — it sees the same `context` the handler will
(the resolved session included) and either returns a reply to **deny** the
request or `undefined` to **pass**. Guards run in the order the route lists
them, first denial wins, and each may be sync or async; a thrown guard takes
the `onError` path like a throwing handler. Guards live next to the handler
(`defineRoute`, `implementRoute`, `routeImplementer`), never on the
browser-safe `defineContract` — but their *outcome* stays contract-declared,
because a guard can only deny with a status the route's `responses` map
declares. That single rule is what keeps enforcement honest: the `401`/`403` a
guard produces is already in the OpenAPI document, and forgetting to list the
status is a compile error, not a silently-open endpoint.

Guards attach in exactly one place — the `guards` field, wherever you declare
the route (`defineRoute` / `implementRoute` / `routeFactory` / `routeImplementer`).
`requireContext(predicate, deniedReply)` builds the common session/role check
once, and it reuses across every route:

```ts
import { requireContext, type ContextGuardInput } from '@amritk/api'

// guards.ts — reusable across routes; the predicate reads the app context.
export const requireSession = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null,
  { status: 401, body: { error: 'unauthorized' } },
)
export const requireAdmin = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.user.role === 'admin',
  { status: 403, body: { error: 'forbidden' } },
)

// routes.ts — guards run before the handler, in order.
export const deleteUser = defineAppRoute({
  method: 'delete',
  path: '/users/{id}',
  request: { params: idParams },
  responses: { 204: {}, ...authResponses }, // 401 + 403, declared once (see below)
  guards: [requireSession, requireAdmin],
  handler: async ({ params, context }) => {
    await context.db.delete(users).where(eq(users.id, params.id))
    return { status: 204 }
  },
})
```

The status a guard denies with stays **declared on the contract**, not derived
from the guard — the contract remains the single source of truth for the wire,
so the OpenAPI document, response validation, and the typed `createClient` are
all correct with nothing to reconcile. A guard can only deny with a status the
route declares (`RouteReply` types the guard's return), so forgetting to list it
is a compile error, not a silently-open endpoint.

Keep the boilerplate DRY by declaring the shared shape once and spreading it —
the reply value and its schema live next to each other so they cannot drift:

```ts
// auth-responses.ts
const errorSchema = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } as const
export const authResponses = { 401: { body: errorSchema }, 403: { body: errorSchema } } as const
```

For a denial reply that varies per request (naming the missing scope, say),
skip `requireContext` and write the guard inline — it is just
`(ctx) => reply | undefined`. Both engines run guards identically (the compiled
module threads the live `contract.guards` through the same order), pinned by the
differential corpus.

### Route-scoped response hooks

`guards` cover the request side of a route group. `onResponse` covers the reply
side: per-route timing, a header stamped on one group of routes, an audit
record written from the reply — the wrap-around seam, without a middleware
onion.

```ts
const withTiming = defineRoute({
  method: 'get',
  path: '/reports/{id}',
  request: { params: reportParams },
  responses: { 200: { body: reportSchema } },
  onResponse: [
    (reply, { params, context }) => {
      // The context is the validated one the handler saw — coerced params, the
      // resolved session — which is what makes an audit hook worth having.
      context.audit.record({ report: params.id, status: reply.status })
      return undefined // keep the handler's reply as it stands
    },
  ],
  handler: ({ params, context }) => ({ status: 200 as const, body: context.reports.get(params.id) }),
})
```

Hooks run in order, each seeing the previous one's result; returning
`undefined` keeps the reply, and returning a reply replaces it. A replacement
goes through the same response validation the handler's would have, so a hook
cannot smuggle out an undeclared status. A thrown hook takes the handler-error
path (`onError`) exactly like a throwing handler. Guard denials reach the hooks
too — a denial is a reply like any other.

Two things they deliberately do not do. They do **not** run on a
*security*-guard denial: those fire before validation and before the context
factory precisely so an unauthenticated request never reaches app code, which
means the `RequestContext` a hook expects does not exist yet — use the
adapter's `onResponse` for decoration that must cover every reply. And they are
**not** an onion. An onion decides what runs around what by nesting, so the
answer depends on registration order across unrelated modules; these are a list
on the route, which is also what lets `compileToModule` emit them as
straight-line code.

The cost is the point of the shape. A route that declares no hooks pays one
`undefined` check in the runtime engine and nothing at all in the compiled one,
where the branch is resolved at emit time — a hookless route emits exactly the
code it always did, with no wrapper and no extra frame.

### Deny-by-default: `secureRoutes`

Per-route `guards` are opt-**in**: an un-guarded route is public, so a
forgotten guard is a silently-open endpoint. When you want the opposite — every
route requires auth and you name the *public* ones — reach for `secureRoutes`.
It reads OpenAPI's own security model: a **document-level** `security` default
applies to every route, and a route opts out with `security: []`.

The link between a scheme and the guard that enforces it is an `x-guard`
extension on the Security Scheme Object — the `securityGuard` key. `secureRoutes`
resolves each route's effective `security` (its own, or the document default)
into those guards and prepends them to the route's `guards`:

```ts
import { requireContext, secureRoutes, securityGuard, type ContextGuardInput } from '@amritk/api'

const requireSession = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null,
  { status: 401, body: { error: 'unauthorized' } },
)
const requireAdmin = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.user.role === 'admin',
  { status: 403, body: { error: 'forbidden' } },
)

// One declaration carries the scheme's OpenAPI shape *and* its guard.
const securitySchemes = {
  bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireSession },
  adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
} as const
const security = [{ bearerAuth: [] }] // the deny-by-default: every route needs a session

// getAdminPanel declares `security: [{ adminAuth: [] }]`; health declares `security: []`.
export const routes = secureRoutes([getProfile, getAdminPanel, health], { securitySchemes, security })

// Pass the same schemes/security on for the document — the guard is stripped from it.
export const api = createApi({ routes, securitySchemes, security })
```

Resolution follows OpenAPI exactly: schemes within one requirement object are an
**AND** (all must pass); several requirement objects are an **OR** (any passing
alternative allows the request, and when none does the client sees the *first*
alternative's denial — the primary way in, rather than whichever happens to be
last in the array). A guard shared by two alternatives runs once per request.

A requirement's **scopes** are enforced, not just documented: they reach the
scheme's guard as its second argument, so one `oauth2` scheme covers every scope
combination the document advertises.

```ts
const requireScopes = requireContext(
  (ctx: ContextGuardInput<AppContext>, scopes) => scopes.every((s) => ctx.context.session?.scopes.includes(s)),
  { status: 403, body: { error: 'insufficient_scope' } },
)
// `security: [{ oauth2: ['billing:write'] }]` calls it with ['billing:write'].
```

**Security guards run before validation.** Unlike the route's own `guards`, they
are the first thing a matched request meets: the context factory resolves the
session, the guards gate on it, and only then does the pipeline coerce and
validate slots, read the body, or run `refine`. An unauthenticated caller
therefore never reaches the body parser, the schema error detail, or app code.
Their context carries the app `context` and the raw `request`; the validated
slots are `undefined`, which is why a security guard gates on the session rather
than on typed input.

Four things are startup errors, all of them fail-closed:

1. A requirement naming a scheme that is undefined, or defined without an
   `x-guard` — you cannot document a route as protected and have it silently
   serve unprotected.
2. An empty requirement object (`{}`). OpenAPI reads it as "authentication
   optional", so a stray one makes a route public and every sibling alternative
   moot — indistinguishable from a typo. Use `security: []` to mark a route
   public, or `allowOptionalSecurity: true` if you really mean optional.
3. A guard whose denial status the route's `responses` does not declare. This is
   the guarantee type erasure takes away — a `requireContext` guard on `guards`
   is compile-checked against `responses`, one arriving through a scheme cannot
   be — so it is checked at startup instead, which also stops `validateResponses`
   from turning a denial into a 500. Opt out with `allowUndeclaredDenials: true`.
4. Calling `createApi`/`compileToModule` with a `security` default while a route
   it covers never went through `secureRoutes`. Without this, the document
   asserts every operation needs auth while the routes serve anonymously.

Because the guards land on `contract.securityGuards`, both engines honor them
with no further wiring — `createApi` runs them per request and `compileToModule`
threads the same live array through its emitted pipeline, so no `securitySchemes`
need reach the compiled module for enforcement.

The generated document is served *before* route matching, so `secureRoutes` does
not cover it — under a deny-by-default API the schema stays public unless you say
otherwise. Gate it with `openApiGuards`, which run exactly like a route's:

```ts
createApi({ routes, securitySchemes, security, openApiGuards: [requireSession] })
```

The compiled engine names them by export, like its other hooks:

```ts
compileToModule({ routesImport, routes, openApiGuardExports: ['requireSession'] })
```

Reach for `secureRoutes` when the safe default is *closed*; reach for the bare
`guards` field for per-route, fine-grained checks that need the validated
request — those still run after validation, just before the handler.

### Auth: Better Auth

Two touch points, both first-class. Better Auth's own endpoints are a
self-contained fetch handler that owns `/api/auth/*` — mount it by prefix and
the raw `Request`/`Response` pass straight through (streaming intact). The
mount handler also receives the platform `env` and `executionContext`, so a
per-request, env-dependent instance (secrets and the DB URL live on `env`,
which only exists inside `fetch` on Cloudflare Workers) can be built right
there:

```ts
export const auth = betterAuth({ /* ... */ })

const handler = toFetchHandler(api, {
  mounts: { '/api/auth': (request) => auth.handler(request) },
})

// Workers: build the instance from env inside the mount.
const workerHandler = toFetchHandler(api, {
  mounts: { '/api/auth': (request, env) => makeAuth(env as Env).handler(request) },
})
// Express instead: app.all('/api/auth/*', toNodeHandler(auth)); app.use(toNodeHandler(api))
// Compiled: compileToModule({ ..., mounts: { '/api/auth': 'authMountHandler' } })
```

**The auth endpoints already exist — you write none of them.** The mount hands
`/api/auth/*` to Better Auth's own handler, so every endpoint it serves —
`sign-up/email`, `sign-in/email`, `sign-out`, `get-session`, and whatever your
enabled plugins add (magic link, passkey, 2FA, organization…) — works without a
single route contract on your side. Call them from the browser with Better
Auth's own typed client (`createAuthClient`), generated from *your* config and
plugins, so it always matches what the server actually serves. To surface them
in one unified OpenAPI page, enable Better Auth's OpenAPI plugin (it generates a
schema from your live config) and serve it alongside `@amritk/api`'s
`/openapi.json`.

The framework deliberately ships **no** built-in Better Auth contracts. Baking a
vendor's endpoint shapes into the core would drift across versions, go blind to
which plugins you enabled, and pull one SDK's surface into a vendor-neutral
layer — the opposite of the mount seam. Better Auth stays the source of truth
for its own API; the mount is how it plugs in, and the endpoints it serves are
the login calls you were going to write.

The session flows through the app context, and a [guard](#guards-authorize-once-declare-the-outcome)
enforces it — the protected route *declares* its 401, so the auth behavior
shows up in the OpenAPI document like everything else:

```ts
export const createContext = async ({ request }: ContextFactoryInput) => ({
  session: await auth.api.getSession({
    headers: new Headers({ cookie: request.header('cookie') ?? '' }),
  }),
})

// implementAppRoute = routeImplementer<AppContext>() — binds a handler (and
// guards) to a handler-free contract, so contracts.ts stays browser-safe.
export const getProfile = implementAppRoute(getProfileContract, {
  // requireSession denies with the declared 401 before the handler runs, so the
  // handler only ever sees an authenticated session.
  guards: [requireSession],
  handler: ({ context }) => ({ status: 200, body: toProfile(context.session.user) }),
})
```

where `getProfileContract` (pure data, browser-safe) declares both responses:

```ts
export const getProfileContract = defineContract({
  method: 'get',
  path: '/profile',
  responses: {
    200: { body: profileSchema },
    401: { body: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
  },
})
```

If only some routes need the session, make the context lazy (`session: () =>
memoizedLookup()`) so public routes never pay for the cookie check.

#### Native apps: magic link without a browser's cookie jar

A magic-link sign-in from an iOS/Android/Expo app runs the same mount, but the
session never arrives the way the example above assumes. Every step that leans
on a browser holding cookies for you — the redirect target, the session lookup,
the CSRF check, the client — needs one deliberate change.

**The link opens the system browser, not your app.** Better Auth mints a
single-use token (5 minutes by default), and `/api/auth/magic-link/verify`
consumes it and `302`s to `callbackURL`. Point that at a deep link and add the
scheme to Better Auth's `trustedOrigins` — an untrusted `callbackURL` is
refused, which is the whole point of the list:

```ts
export const auth = betterAuth({
  trustedOrigins: ['myapp://'], // 'exp://192.168.*.*:*/**' too, in Expo dev only
  plugins: [magicLink({ sendMagicLink }), bearer()],
})
```

The mount needs nothing: a `302` carrying `Set-Cookie` and a custom-scheme
`Location` is proxied out untouched, exactly like [any other redirect](#multiple-set-cookie-headers).
`createSecurityHeaders`/`createCors` still stamp that hop — it is a real browser
response — and the mount's immutable headers are handled for you.

**Then the app authenticates by header, not by cookie jar.** Either shape works;
they differ only in which header the client sends:

| Client | What it stores | What it sends |
|:--|:--|:--|
| Expo plugin | cookie string in `expo-secure-store` | `Cookie: <authClient.getCookie()>`, with `credentials: 'omit'` so the manual header isn't overwritten |
| `bearer()` plugin | the `set-auth-token` response header | `Authorization: Bearer <token>` |

The Expo shape is aimed at Better Auth's *own* endpoints. For your contracted
routes prefer `bearer()`: it is the one that gives the session lookup and the
CSRF exemption below a single header to key on.

**So forward both headers into `getSession`.** The browser example forwards only
`cookie`; a bearer client's session silently resolves to `null` against it —
every guard denies with its declared 401 and the failure looks like a bad token
rather than a dropped header:

```ts
export const createContext = async ({ request }: ContextFactoryInput) => ({
  session: await auth.api.getSession({
    headers: new Headers({
      cookie: request.header('cookie') ?? '',
      authorization: request.header('authorization') ?? '',
    }),
  }),
})
```

**And exempt those requests from CSRF.** `createCsrf` rejects any unsafe-method
request without a matching `csrf_token` cookie, so a native `POST` gets a `403`
before the handler — there is no page script to read the cookie and echo it.
`exemptBearer` is that exemption, written the safe way:

```ts
import { createCsrf, exemptBearer } from '@amritk/api'

const csrf = createCsrf({ exempt: exemptBearer })
```

It exempts a request that carries a bearer token **and no cookies**, and the
second half is the load-bearing one. CSRF is a browser problem: the attack exists
because a browser spends its ambient cookies on a cross-site request without
being asked. A client with no cookie jar has nothing ambient to spend, so there
is nothing to forge — a bearer token only rides a request because code put it
there, and an attacker who knows the token does not need a victim's browser at
all.

Keying on the header alone would be a bypass, which is why the cookie check is
there. A cross-site page can bolt `Authorization: Bearer anything` onto a
credentialed request; the header does not have to be *valid* to switch the check
off, and the victim's cookie goes on authenticating the call underneath it. That
needs permissive credentialed CORS to reach you — but the CSRF check is precisely
the layer meant to survive that misconfiguration, so it must not be disarmed by a
header any caller can set.

The other tempting shortcut fails from the opposite direction: exempting requests
with no `Origin` looks equivalent and is not, since plenty of same-site form posts
arrive without one, handing the bypass to the browser traffic the check protects.

This exempts bearer callers only — a client on the Expo cookie shape still
arrives without an `x-csrf-token` and still takes the `403`. Either give it
`bearer()` for your API surface, or have it echo the `csrf_token` the decorator
seeds; there is no third option that keeps the check honest.

CORS needs no native-specific handling — a native client sends no `Origin`, so
`createCors` has nothing to negotiate. Keep `trustedOrigins` (Better Auth's
redirect allow-list, where the `myapp://` scheme goes) separate from
`createCors`'s `origin` (browser origins for the SPA); they answer different
questions and a custom scheme belongs only in the former.

On the client, `createBearerSession` covers the whole round trip — it attaches
the stored token, persists any rotated one off the reply, and clears the session
when the server stops accepting it:

```ts
import * as SecureStore from 'expo-secure-store'
import { createBearerSession, createClient } from '@amritk/api/client'

const session = createBearerSession({
  storage: {
    get: async () => (await SecureStore.getItemAsync('session')) ?? undefined,
    set: (token) => SecureStore.setItemAsync('session', token),
    clear: () => SecureStore.deleteItemAsync('session'),
  },
  onExpired: () => router.replace('/sign-in'),
})

const client = createClient(contracts, 'https://api.example.com', { fetch: session.fetch })
// after the magic-link deep link resolves: session.set(token)
// on sign-out: session.clear()
```

Two security notes on that wiring. The token is a **live session**, so keep it
where the platform protects it — `expo-secure-store`, the iOS keychain,
Android's `EncryptedSharedPreferences` — and not in `AsyncStorage` or
`localStorage`, where any script or process that gets in walks off with the
session. And point this fetch at **your API only**: it captures `set-auth-token`
from whatever answers, so a fetch reused across arbitrary hosts lets any of them
overwrite the stored session.

**There is no refresh in this model — there is one token and you send it every
time.** No refresh token, no renewal endpoint, no rotation. Better Auth's session
token is an opaque handle to a server-side row, and it does not change for the
life of the session. What changes is that row's expiry: a request arriving past
`updateAge` (default 1 day) rolls it forward to `now + expiresIn` (default 7
days). So an app in regular use stays signed in without ever renewing anything,
purely as a side effect of the calls it was already making.

Go quiet for longer than `expiresIn` and the next call takes a `401`, which
clears storage and fires `onExpired`. A magic-link session has nothing to renew
*from*, so signing in again is the only way back — routing there is the correct
handling, not a gap you should try to close with `refresh`.

Which means, concretely: leave `refresh` unset. It exists for the other server
shape, where renewal is a real request (the JWT plugin's short-lived
`set-auth-jwt`, an OAuth provider, your own endpoint). Capturing `set-auth-token`
is how the token lands in storage when sign-in runs through this fetch; on a
plain magic-link setup it fires there and nowhere else. What the wrapper earns
its keep on here is the unglamorous half — attaching the token without an await
on the hot path, and clearing a dead session so a stale token cannot sit in the
keychain. See [client-side auth refresh](#client-side-auth-refresh) for the two
models that do renew.

### Sessions: a production setup

Better Auth owns the session — issuing it, expiring it, revoking it. What this
framework owns is everything wrapped around it, and the pieces have to agree with
each other. Here they are in one place, for the case worth designing for: **one
server, a browser SPA and a native app**.

**Start from a server-held session.** The default — an opaque token pointing at a
row Better Auth controls — is the right one, and the reason is revocation. Sign-out
kills every copy of the credential on the next request; a self-contained token
cannot be recalled once issued, so a stolen one stays good for its whole lifetime
no matter what you do. Reach for the JWT plugin when a *second* service or an edge
worker has to verify identity without calling you, and let it verify against
`/jwks` for that hop only. Keep the client session as it is.

The wiring, in the order it runs:

```ts
import type { FetchOnRequest } from '@amritk/api'
import {
  createCors, createCsrf, createRateLimit, createSecurityHeaders, exemptBearer, toFetchHandler,
} from '@amritk/api'

const cors = createCors({ origin: ['https://app.example.com'], credentials: true })
const csrf = createCsrf({ exempt: exemptBearer })

// Auth endpoints get their own, much tighter budget. `key` matters more than
// `limit` here — see below.
const authLimit = createRateLimit({ limit: 5, windowMs: 60_000, key: (request) => `auth:${verifiedIp(request)}` })

const AUTH_PREFIX = '/api/auth'
// Slice the pathname by hand rather than `new URL(request.url)`: a URL object
// parses and normalizes the whole URL, which benchmarks at roughly a fifth of
// the adapter's per-request cost — and this gate runs on every request, not just
// the auth ones.
const isAuthPath = (url: string): boolean => {
  const schemeEnd = url.indexOf('://')
  const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)
  if (pathStart === -1 || !url.startsWith(AUTH_PREFIX, pathStart)) return false
  // Boundary check, so `/api/authorize` is not swept in with the auth mount.
  const next = url.charAt(pathStart + AUTH_PREFIX.length)
  return next === '' || next === '/' || next === '?'
}

const limitAuthOnly: FetchOnRequest = (request, env, executionContext, locals) =>
  isAuthPath(request.url) ? authLimit.onRequest(request, env, executionContext, locals) : undefined

const handler = toFetchHandler(api, {
  mounts: { '/api/auth': (request, env) => makeAuth(env as Env).handler(request) },
  onRequest: [cors.onRequest, limitAuthOnly, csrf.onRequest],
  onResponse: [createSecurityHeaders(), cors.onResponse, csrf.onResponse],
})
```

**Gates run before mounts and decorators run after**, which is the property this
setup leans on: `/api/auth/*` is inside the rate limit, the CORS negotiation, and
the security headers, rather than a hole punched through them. A mounted vendor
router is still your traffic.

**Rate-limit the auth mount.** This is the one most setups skip, and passwordless
raises the stakes: an unthrottled magic-link endpoint is an email-bombing tool
pointed at your users and a paid-for spam relay pointed at your bill, and the
reply usually differs enough between a known and unknown address to enumerate
accounts. The default rate-limit key is **a spoofable client IP header** — fine
for protecting capacity, useless against an attacker who rotates it. For an auth
throttle, key on a proxy-verified IP for your topology, and consider a second
limiter keyed on the submitted email so one address cannot be targeted from many
sources.

**Keep the session lookup lazy, and think twice before caching it.**

```ts
export const createContext = async ({ request }: ContextFactoryInput) => ({
  // Lazy, so public routes never pay for it; memoized, so guards and handlers
  // in one request share a single lookup.
  session: memoize(() =>
    auth.api.getSession({
      headers: new Headers({
        cookie: request.header('cookie') ?? '',
        authorization: request.header('authorization') ?? '',
      }),
    }),
  ),
})
```

Caching sessions *across* requests is where a setup quietly stops being modern:
every second of TTL is a second a revoked session keeps working, so the cache
trades away the exact property you chose a server-held session for. If the lookup
genuinely becomes your bottleneck, cache it briefly (single-digit seconds) and
invalidate on sign-out — and treat the revocation delay as a number you picked
rather than one you inherited.

> **Check whether your platform is already caching it for you.** Cloudflare
> Hyperdrive caches eligible read queries **by default** — `max_age` 60s plus
> `stale_while_revalidate` 15s — and does not invalidate on write, so a session
> lookup routed through a default config can keep authorizing a signed-out user
> for over a minute. Cloudflare's own guidance names authentication, sessions,
> and permissions as reads that need a **second, cache-disabled Hyperdrive
> binding**; connection pooling and edge connection setup still apply, so you
> keep the latency win and drop only the staleness. When an auth library owns the
> SQL, give it its own client built on the cache-disabled binding.

**Where the latency actually goes.** Worth knowing before optimizing the wrong
layer, because the costs here differ by three orders of magnitude:

| Per request | Cost |
|:--|:--|
| The gates and decorators above | single-digit **micro**seconds — a method check, a header set, a cookie split on unsafe methods |
| `new URL()` in a hand-rolled gate | ~⅕ of the adapter's per-request cost, which is why the snippet above slices the path instead |
| **The session lookup** | **1–50 ms**, depending on how far your database is |
| Shared-store rate limiter | one store round-trip — scoped to `/api/auth/*` here, so ordinary traffic never pays it |
| CORS preflight (browser only) | a whole extra round trip, on the first request of each shape |

So the middleware is noise and the session lookup is the entire story. Three
things move it, in order of effect: **keep it lazy** so public routes pay nothing,
**memoize it per request** so a guard and a handler share one lookup instead of
two, and **put the session store next to the compute** — a query to a database
one region away costs more than every other row in this table combined, and no
amount of hook tuning buys it back. Only after those does a cross-request cache
become worth its revocation delay.

On Workers specifically, adding a session lookup is what makes
[Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/)
worth turning on. Cloudflare's numbers are 20–30 ms per query from a distant
region against 1–3 ms when the Worker runs near the database — and placement does
nothing for a request that makes a *single* query, since the round trip costs the
same wherever it happens. A session lookup plus the handler's own query is two
sequential round trips, which is exactly the case placement compounds in your
favour. Hyperdrive already removes the seven round trips of connection setup (TCP
1×, TLS 3×, auth 3×) by pooling warm connections near the database; placement
addresses the query legs that remain.

The native client is the cheaper of the two, for what it is worth: no preflight
(nothing to negotiate without an `Origin`), no cookie header to parse, and the
CSRF gate exits immediately.

**Then declare both client shapes**, so the OpenAPI document tells the truth about
an API that now accepts two kinds of credential:

```ts
const securitySchemes = {
  sessionCookie: { type: 'apiKey', in: 'cookie', name: '<your session cookie>', [securityGuard]: requireSession },
  bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireSession },
} as const
// Either satisfies the requirement: two single-scheme entries, not one entry with both.
const security = [{ sessionCookie: [] }, { bearerAuth: [] }]
```

Two entries rather than one is the difference between "either credential works"
and "send both", and only the first is true here. Wrap the routes with
[`secureRoutes`](#deny-by-default-secureroutes) so the default is closed and you
name the public ones.

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

Here `security` only *documents* the requirement. To also **enforce** it —
turning the same document default into deny-by-default auth — attach an
`x-guard` to each scheme and wrap the routes with
[`secureRoutes`](#deny-by-default-secureroutes).

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

### Typed client for external consumers

Consumers outside the monorepo cannot import your contracts, so they generate
from the document instead — it is served at `/openapi.json` and is ordinary
OpenAPI 3.2, which any SDK generator reads.

Monorepo-internal frontends should prefer
[`createClient`](#typed-client-createclient): it derives its types from the
contracts directly, so there is no generated artifact to keep in sync and no
codegen step in the build.

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
| Per-route authorization (sessions, roles, scopes) | route `guards` field + `requireContext` (the denial status stays declared on the contract) |
| Sentry / error reporting | `onError` (`createSentry` packages it) |
| Metrics, request logging | `observe` + `observeUnmatched` (route pattern, status, duration) |
| Rate limits, feature flags, CSRF, origin checks | `onRequest` gates |
| Security headers, CORS | `onResponse` decorators / `createCors` |
| Auth ↔ handler state (resolved tenants, counters) | per-request `locals` bag |
| Platform data (Workers `request.cf` geo/ASN) | `request.raw` escape hatch |
| Typed clients | `createClient` from shared contracts; the OpenAPI document for external consumers |

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

- Request bodies validate as JSON, form-encoded, multipart, or raw
  `text`/`bytes` per the contract's `bodyType`; the raw bytes are always also
  available via `readText`/`readBytes` (webhook signatures), and raw/streaming
  **responses** are first-class via `contentType`.
- Route paths use OpenAPI syntax (`/users/{id}`); a parameter owns its whole
  segment. A greedy tail parameter — `/files/{path+}`, the AWS API Gateway
  convention — captures one or more remaining segments, decoded individually
  and joined with `/` (`/files/docs/2026/q1.pdf` → `path: 'docs/2026/q1.pdf'`).
  It must be the last segment; the bare prefix (`/files`) stays a 404.
- Static paths always win over parameterized ones; parameterized routes match
  in registration order.
