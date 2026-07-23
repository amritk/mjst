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
6. **Guards authorize; they live on the route, not the contract.** Add
   `guards: [...]` to `defineRoute`/`implementRoute`/`routeImplementer` (never
   `defineContract` — it stays browser-safe data). A guard `(ctx) => reply |
   undefined` runs after the context factory, before the handler, and can only
   deny with a status the route's `responses` declares — so declare the 401/403
   or it is a compile error. `requireContext(predicate, deniedReply)` packages
   the common session/role check into a reusable guard.

## Subpath entry points

| Import | Purpose |
|---|---|
| `@amritk/api` | runtime, client, adapters, OpenAPI, hook factories |
| `@amritk/api/bundler` | build-time plugins (`stripContractsVite`/`Esbuild`/`Rollup`/`Bun`) that strip server/OpenAPI freight from `defineContract` sites in browser builds — build tooling only, never in runtime code |

Schemas authored in Zod / TypeBox / Valibot / Effect: convert with
`@amritk/adapters` first. Install: `bun add @amritk/api`.
