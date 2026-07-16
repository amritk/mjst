# Readiness: adopting `@amritk/api` in agent-ummo

An audit (2026-07) of every HTTP surface in the agent-ummo monorepo against
what `@amritk/api` ships today, to answer one question: **what must the
framework grow before agent-ummo's apps can move onto it?**

> **Status update (2026-07, later the same month): every P0 and P1 gap below
> is now shipped**, in both the runtime and compiled engines, with
> differential coverage. Raw bodies + `maxBodyBytes` (413), streaming
> `contentType` replies + `ApiRequest.signal`, `onRequest`/`onResponse` hook
> chains + `createCors`, `errors` formatters, `request.headers` schemas, and
> a Hey API (openapi-ts) typed-client integration test replacing the `hc`
> dependency. See `api-framework-plan.md` § "Shipped: the agent-ummo
> readiness set". The sequencing plan at the bottom is now unblocked from
> step 1 through step 5.

## What agent-ummo runs today

Five Hono 4 servers, all deployable as Cloudflare Workers, three also run
under `Bun.serve` locally:

| App | Shape | The demanding parts |
|:--|:--|:--|
| `agent-api` | public chat gateway | **streaming** chat response (`ReadableStream`, `text/plain` + U+001E product frame), client-abort handling, API-key auth, two-tier rate limiting, CORS with exposed headers, 402 demo quota |
| `admin` | SPA + internal API | Better Auth (magic link) mounted at `/api/auth/*`, fail-closed session gate, **CSV upload via raw `arrayBuffer()`** (5 MB cap → 413), CORS with credentials, security headers on every response |
| `dashboard` | SPA + customer API | Better Auth, tenant membership via `X-Tenant-Id`, **Stripe webhook (raw-body HMAC)**, feature-flag gate (503), bounded body reader on a public route |
| `embedding-service` | service-to-service ingestion | shared-secret auth, hand-rolled body validators, 200/207/502 batch semantics, Workflows + cron (outside routing) |
| `shopify` | OAuth + webhooks (not yet deployed) | **raw-body HMAC**, 302 redirects with `Set-Cookie`, per-install signed webhook tokens |

Cross-cutting: env validation is already `@amritk/runtime-validators`
everywhere (inline JSON Schema + `assert` + `FromSchema`); request validation
is split between zod (6 files) and hand-rolled guards (the rest) — an
inconsistency agent-ummo's own AUDIT.md flags for consolidation. There is no
OpenAPI generation anywhere. One typed-client dependency exists: `chat-ui`
calls agent-api through Hono's `hc<AppType>` RPC client.

## What already fits

These agent-ummo needs are covered by the framework as shipped:

- **Workers + Bun from one app object** — `toFetchHandler` is the
  `fetch(request, env, ctx)` shape both accept; `env`/`executionContext` flow
  into the `context` factory, which covers Hyperdrive handles, `waitUntil`
  teardown, KV/rate-limiter bindings, and session lookup.
- **Contract validation replacing zod + hand-rolled guards** — params/query
  coercion, guard-first body validation, typed handlers. Aligns with the
  env layer agent-ummo already uses; deletes the ~80 lines of hand-rolled
  validators in embedding-service that its audit flags.
- **Better Auth passthrough** — `mounts` hands `/api/auth/*` the raw
  `Request` and returns its `Response` untouched, streaming intact.
- **Arbitrary declared statuses** — 201/202/207/402/409/413/503, and 302 +
  `Set-Cookie` via reply `headers`.
- **SPA coexistence** — `api.matches()` lets a worker wrapper route `/api/*`
  to the app and everything else to Workers Assets (the `createSpaWorker`
  pattern keeps working).
- **OpenAPI 3.1** — free upgrade; nothing in agent-ummo has docs today.
- **Workers performance story** — eval-free runtime engine for dev,
  `compileToModule` for production, both above Hono+zod in the measured
  cases.

## Gaps, in priority order

### P0 — adoption blockers (three apps each hit at least one)

1. **Raw request-body access.** `ApiRequest.readBody` is JSON-only and the
   fetch adapter hard-binds it to `request.json()`. Stripe and Shopify HMAC
   verification need the exact raw bytes/text *before* any parsing; admin's
   CSV upload needs `arrayBuffer()` with a byte cap. Needed: expose the
   body as text/bytes on `ApiRequest` (or the original `Request`), keep it
   lazy, and add a `maxBodyBytes` → 413 option so bounded readers like
   dashboard's `/leads` don't have to be hand-rolled.
2. **Streaming / non-JSON replies + abort signal.** `ApiResponse.body` is
   always `JSON.stringify`ed; there is no way to return a `ReadableStream`,
   a different content-type, or observe client disconnect
   (`ApiRequest` has no `signal`). agent-api's `/chat` — the single most
   important route in the product — cannot be expressed except as an
   uncontracted `mount`, which forfeits validation and OpenAPI for the one
   route that needs its request schema most. This is the "content
   negotiation" roadmap item; the minimum viable cut is: a raw-`Response`
   (or stream-body) reply escape hatch on a contracted route, plus
   `signal` on `ApiRequest`.
3. **Request/response hooks (middleware-lite) + CORS.** Every agent-ummo app
   stamps security headers on **every** response including 400/404/500,
   and runs short-circuiting gates before handlers: CORS preflight
   (automatic `OPTIONS` handling, credentialed origin reflection, exposed
   headers), origin/CSRF check, rate limits (429 + headers), feature flag
   (503), request logging. The framework deliberately has no middleware
   chain, and context + mounts don't cover "rewrite every outgoing
   response" or "answer OPTIONS for declared routes". Needed: an
   `onRequest` hook that can short-circuit with an `ApiResponse` and an
   `onResponse` hook for header stamping — plus first-class CORS (it needs
   route-table knowledge for preflight, so it belongs in the framework,
   not user code).

### P1 — needed during migration, workaroundable briefly

4. **Customizable error envelopes.** 404 (`{error:'not_found'}`), invalid
   JSON, and validation-failure bodies are frozen constants; only thrown
   handler errors reach `onError`. agent-ummo's convention is
   `{ error: string }` with a single readable message, and admin varies
   error detail by session. Needed: formatter hooks for not-found /
   invalid-JSON / validation-failure (or a documented decision that
   adopters take the framework's richer envelope — but that is a breaking
   change for the deployed widget's 402/error handling).
5. **Typed client.** `chat-ui` consumes agent-api via Hono's `hc<AppType>`;
   moving agent-api off Hono deletes that typing. Needed: a typed client
   derived from route contracts (type-level, like `hc`) or generated from
   the OpenAPI document. The chat route is streaming (thin typing today),
   so this doesn't block the pilot apps — but it blocks agent-api.
6. **Header schemas.** Already on the roadmap. agent-ummo reads
   `X-API-Key`, `X-Tenant-Id`, `stripe-signature`, `X-Sync-Secret` — all
   work via `request.header()` today, but contract-declared headers would
   document the auth surface in OpenAPI.

### P2 — valuable, not gating

7. **Compile-integration sugar** (`mjst` CLI emitting the generated-validator
   `compile` map and the production module) — the prod-perf ceiling.
8. **`$ref`/`components` hoisting, example generation, Fastify plugin** —
   existing roadmap items; nothing in agent-ummo needs them.

Not gaps: rate-limiter/CSP helper implementations (stay in
`@agent-ummo/helpers`), Better Auth/Stripe/Shopify SDKs, Workflows/cron
(declared beside the fetch handler, orthogonal to routing). Zod transforms
and cross-field refinements (origin normalization, total-char caps) move
into handler code — JSON Schema deliberately doesn't express transforms.

## Suggested sequencing

1. Ship P0 items 1 and 3 (raw body, hooks + CORS) — small, independent.
2. **Pilot: `embedding-service`.** JSON-only, no streaming, no webhooks,
   hand-rolled validators begging for contracts; needs only hooks for
   security headers. Proves the Workers + Workflows + context wiring.
3. **`admin` and `dashboard`** once raw body + hooks land (CSV upload,
   Stripe webhook, Better Auth mount, feature-flag gate as `onRequest`).
4. Ship P0 item 2 (streaming + signal) and P1 item 5 (typed client), then
   **`agent-api`** — the flagship route migrates last, with the widget's
   product-frame protocol unchanged.
5. `shopify` whenever it ships (needs raw body + redirects, both covered by
   then).
