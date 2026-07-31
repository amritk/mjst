# @amritk/api — notes for AI coding agents

Contract-first, framework-agnostic HTTP API layer: declare each route once as
JSON Schema and get a typed handler, runtime request/response validation,
OpenAPI 3.1, and a derived typed client. Fast path for an LLM; full reference is
[README.md](./README.md).

> Pre-alpha: breaking changes land in **minor** versions. ESM-only (no CJS
> entry). `require('@amritk/api')` needs Node 22.12+.

## Mental model

- A **route** = a JSON Schema contract + a handler. `params`/`query`/`body`
  arrive **already validated and coerced** (path `id: {type:'integer'}` is a
  `number` in the handler), and a handler returns `{ status, body }` pairs its
  `responses` map declares — or, as an escape hatch, `raw(response)` wrapping a
  web `Response` that the adapters send verbatim (skipping response validation)
  for full control of the wire output. Return `raw(response)`, never a bare
  `Response`: a bare one in the return union makes TypeScript reject any reply
  whose `status` is itself a union of declared statuses (`{ status: upstream.status }`
  where that is `502 | 503`).
- `createApi({ routes, info })` compiles contracts into a runtime; an **adapter**
  (`toFetchHandler` / `toNodeHandler`) turns it into a real server handler.
- Contracts are **data** — `defineContract` (no handler) is browser-safe and
  drives the typed `createClient`; `defineRoute` bundles the handler in.
  Frontend code (contracts files included) imports both from
  **`@amritk/api/client`**, the entry whose import graph contains no server
  code.

## Minimal example

```ts
import { createApi, defineRoute, toFetchHandler } from '@amritk/api'

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  responses: {
    200: { body: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] } },
    404: {},
  },
  handler: ({ params }) =>
    params.id === 1 ? { status: 200, body: { id: 1, name: 'Ada' } } : { status: 404 },
})

const api = createApi({ routes: [getUser], info: { title: 'Users API', version: '1.0.0' } })
const handler = toFetchHandler(api)
Bun.serve({ fetch: handler })      // or: export default { fetch: handler } on Workers
// GET /openapi.json is served automatically.
```

## Gotchas — where agents fail

1. **Keep schemas literal.** Write request/response schemas inline in
   `defineRoute`/`defineContract`, or declare shared ones `as const`. A plain
   `const schema = {…}` widens the literal before the `const` generics capture
   it and `params`/`query`/`body` collapse to loose types. This is the #1
   failure.
2. **A declared `request.body` is required, and JSON is the default.** For
   other bodies set `request.bodyType: 'form' | 'multipart' | 'text' | 'bytes'`
   alongside the schema. Multipart **file** parts must be declared with **no**
   `type` keyword (`{}`), never `type: 'string'`.
3. **Hooks / `mounts` / CORS are fetch-adapter only.** `toNodeHandler` has no
   `onRequest`/`onResponse`/`mounts`/`createCors` by design — use the Node
   framework's own middleware. `createApi` does not accept them either.
4. **`maxBodyBytes` defaults to 1 MiB** (413 above it). Set it on the *adapter*,
   not `createApi`; uncap with `maxBodyBytes: Infinity`.
5. **Typed client needs opt-in pieces.** `createClient(contracts, baseUrl, options)`:
   pass `serializers: [formBodySerializer, multipartBodySerializer]` for
   form/multipart, `pathParams: buildParamPath` for any `{param}` path,
   `queryParams: toSearchParams` for any call that sends `query`, and
   `cookies: appendCookies` to use the `cookies` slot (Node-only — browsers
   cannot set the `cookie` header). Undeclared response statuses **throw**
   (`isUnexpectedStatusError`) instead of entering the union — declare every
   status you handle. Browser auth uses `fetchOptions: { credentials:
   'include' }`. Frontends import from the **`@amritk/api/client`** subpath —
   same client surface, guaranteed free of server modules, no bundler
   `node:*` externalization warnings.
6. **Guards authorize; attach them in the `guards` field.** Add `guards: [...]`
   to the route (`defineRoute`/`implementRoute`/`routeFactory`/`routeImplementer`
   — never `defineContract`, which stays browser-safe data). A guard
   `(ctx) => reply | undefined` runs after the context factory, before the
   handler, sees the same `context`, and can only deny with a status the route's
   `responses` declares (so declare the 401/403 — a compile error otherwise, and
   the status stays visible to OpenAPI + `createClient`). `requireContext(
   predicate, deniedReply)` builds the common session/role check; declare the
   shared denial shape once (`const authResponses = { 401: {...} } as const`) and
   spread it into each protected route's `responses`. For **deny-by-default**
   (every route requires auth; you name the public ones), wrap the route array
   with `secureRoutes(routes, { securitySchemes, security })`: put the guard on
   each scheme under the `securityGuard` (`x-guard`) key, set a document-level
   `security` default, and opt public routes out with `security: []`. It resolves
   each route's effective `security` into `contract.securityGuards` (AND within a
   requirement object, OR across them — the first alternative's denial is what
   the client sees), so both engines enforce it. A requirement's **scopes** reach
   the guard as its second argument, so `[{ oauth2: ['admin'] }]` enforces
   differently from `[{ oauth2: [] }]`. Unlike the route's own `guards`, security
   guards run **before** slot validation, body reads and `refine` (the context
   factory runs first, so they can gate on the session) — an unauthenticated
   caller never reaches the parser or app code, and their context's request slots
   are `undefined`. Four things throw at startup, all fail-closed: a requirement
   naming an undefined or guard-less scheme; an empty requirement object `{}`
   (`allowOptionalSecurity` opts in); a guard whose denial status the route's
   `responses` omits (`allowUndeclaredDenials` opts out); and — from
   `createApi`/`compileToModule` — a route documented as requiring auth whose
   requirement was never resolved, i.e. `secureRoutes` was not called. Pass the
   *same* `securitySchemes`/`security` to `createApi`/`compileToModule` for the
   document; the guard is stripped from it. The document endpoint itself is
   served before matching, so gate it with `openApiGuards` if the schema is not
   public.
7. **Brand ids with `x-mjst` for nominal params.** A param/query/body property
   `{ type: 'string', 'x-mjst': { brand: 'UserId' } }` makes the handler (and the
   typed client) see `string & { readonly __brand: 'UserId' }` instead of a plain
   `string`, so a `UserId` can't be passed where an `OrderId` is expected — the
   `.$type<UserId>()` protection Drizzle gives a column, at the API boundary. It's
   type-level only (no extra runtime check beyond the base type). Keep the schema
   literal so the brand survives inference, and define your app-side id to the
   same `{ readonly __brand: 'UserId' }` shape.
8. **`format` is not asserted unless you ask.** Like JSON Schema itself and Ajv,
   `format: 'uuid'` is documentation — the route accepts any string. Pass
   `formats: 'all'` (or a list, `['uuid', 'email']`) to `createApi` *and* to
   `compileToModule`, or the compiled module and the dev server disagree. A
   violation is an ordinary 400 `validation_failed`. Ignored when you supply your
   own `compile`, which replaces the engine the option configures.

## Security helpers (fetch adapter + client)

Hook factories ship the standard middleware over `onRequest`/`onResponse`/`locals`:

- **`createSecurityHeaders(opts?)`** (`onResponse`) — helmet-style headers, set
  only when absent. **HSTS and CSP default off** (both lock out the wrong
  deployment); opt in with `strictTransportSecurity: true` /
  `contentSecurityPolicy: '…'`.
- **`createCors(opts)`** — throws at setup on `origin: '*'` + `credentials: true`.
  A reflect-all origin function with credentials trusts every site — validate
  inside the function.
- **`createRateLimit(opts)`** — 429 + `Retry-After`/`RateLimit-*`. **Default key
  is a spoofable client IP header** (`x-forwarded-for[0]` etc.); for auth
  throttling pass a `key` reading a proxy-verified IP or a `locals` user id.
  Default store is in-process/single-instance — pass a shared `store` for a fleet.
- **`createCsrf(opts?)`** — double-submit cookie; rejects empty/missing tokens;
  cookie defaults `Path=/; SameSite=Lax; Secure`, not `HttpOnly` by design.
  Client half: **`createCsrfHeader()`** echoes the cookie into `x-csrf-token`.
- **`signCookie`/`unsignCookie`/`createSignedCookies`** — HMAC-SHA256, constant-time
  verify. **Integrity, not secrecy** — sign a session id, keep session server-side.
- **`createTokenRefresh(opts)`** (bearer) — single-flighted, renews on the token
  clock (JWT `exp` via `decodeJwtExpiry`, unverified — server still verifies).
  Doesn't react to 401s; call `invalidate()` on logout (safe against an in-flight
  refresh). **`createRefreshFetch(opts)`** (HttpOnly cookie) — refresh + replay
  once on 401, single-flighted.

## Subpath entry points

| Import | Purpose |
|---|---|
| `@amritk/api` | runtime, client, adapters, OpenAPI, hook factories |
| `@amritk/api/client` | browser-safe client surface (`createClient`, `defineContract`, opt-in serializers, error predicates, `…Of` type helpers, client-side auth helpers) — its import graph never touches a server module or `node:*` built-in, so frontends importing it get no bundler externalization warnings; use it for contracts files and anything that ships to a browser |
| `@amritk/api/bundler` | build-time plugins (`stripContractsVite`/`Esbuild`/`Rollup`/`Bun`) that strip server/OpenAPI freight from `defineContract` sites in browser builds — build tooling only, never in runtime code |
| `@amritk/api/dev` | hot reloading for the dev server (`createHotApi`, `watchPaths`, `importFresh`) — development only, never in deployed code |

**Hot reload (dev server).** `createHotApi({ load, watch })` returns a normal
`Api` you hand to an adapter once; it rebuilds itself from disk on every save
without restarting the process, so sockets and in-memory state survive. `load`
must *re-read* the routes (`importFresh('./src/routes.ts')`) rather than close
over an import — a plain `import` is cached and would rebuild the same code
forever. Swaps are atomic and a failed reload keeps the previous build serving
(`api.error()` has the reason; a failure before the first build answers 503).
Reload depth: whole local graph on Node 22.15+, the named module elsewhere —
on Bun use `bun --hot` **or** `watchPaths`, never both.

Schemas authored in Zod / TypeBox / Valibot / Effect: convert with
`@amritk/adapters` first. Install: `bun add @amritk/api`.
