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
  `responses` map declares — or, as an escape hatch, a raw web `Response` that
  the adapters send verbatim (skipping response validation) for full control of
  the wire output.
- `createApi({ routes, info })` compiles contracts into a runtime; an **adapter**
  (`toFetchHandler` / `toNodeHandler`) turns it into a real server handler.
- Contracts are **data** — `defineContract` (no handler) is browser-safe and
  drives the typed `createClient`; `defineRoute` bundles the handler in.

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
   form/multipart, and `pathParams: buildParamPath` for any `{param}` path.
   Undeclared response statuses **throw** (`isUnexpectedStatusError`) instead of
   entering the union — declare every status you handle. Browser auth uses
   `fetchOptions: { credentials: 'include' }` (the `cookies` slot is Node-only).

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
| `@amritk/api/bundler` | build-time plugins (`stripContractsVite`/`Esbuild`/`Rollup`/`Bun`) that strip server/OpenAPI freight from `defineContract` sites in browser builds — build tooling only, never in runtime code |

Schemas authored in Zod / TypeBox / Valibot / Effect: convert with
`@amritk/adapters` first. Install: `bun add @amritk/api`.
