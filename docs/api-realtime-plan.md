# Plan: Realtime (`@amritk/api`)

## Goal

Server-pushed updates for a contract-first API, where the application
developer writes **no topic strings, no cache keys, and no invalidation map**.
The route contracts already describe the resource graph; realtime should read
that graph rather than ask for it a second time.

Three properties to hold:

1. **The contract stays the single source of truth.** A pushed payload must
   not be able to drift from the HTTP payload of the same resource.
2. **Correctness does not depend on the socket.** A dropped message must
   self-heal, not leave a permanently wrong cache.
3. **Non-users pay nothing.** No new runtime dependency, no bundle cost for
   apps that never enable it, no schema shipped to the browser.

## Key insight

Realtime normally asks the developer to restate things the contract already
encodes. It does not have to:

| Realtime needs | Already in the contract |
|:---|:---|
| A topic to publish/subscribe on | The resolved path — `/posts/42/comments` |
| A cache key | `[method, pathPattern, params, query]` |
| A payload schema | The mutation's own success response body |
| What to do with the payload | The HTTP method — `POST` appends, `PATCH` merges, `DELETE` removes |
| Who may subscribe | The corresponding `GET` route's existing guards |
| Where an embedded resource lives in a bigger response | The response schema, walked at startup |
| A transport | `sseStream` (`src/sse.ts`) + `contentType: 'text/event-stream'` |
| A place to publish without adding latency | `runAfterResponse` / `WaitUntilContext` (`src/after-response.ts`) |
| A pluggable backend seam | The `RateLimitStore` / `memoryRateLimitStore` pattern |

The path is simultaneously the topic, the cache key, and the authorization
unit. Everything else falls out of that.

## Two layers, not one

The design is **invalidation as the correctness floor, payload push as a fast
path that degrades into it.** These are not alternatives:

- **Invalidate** — the server says "`/posts/42/comments` changed"; the client
  refetches through the normal typed HTTP path. Self-healing: a dropped
  message costs latency, never correctness.
- **Push** — the server ships the comment itself; the client splices it into
  cache. One socket hop, no refetch. But a dropped message leaves the cache
  silently wrong forever.

So push is an optimization layered on invalidation, and every failure mode in
the push path (sequence gap, reconnect past the replay buffer, unknown
embedding) falls back to invalidating the affected resource. Build the floor
first.

## The problem that shapes the design

Take a newsfeed. The frontend calls `GET /feed`, which returns hydrated posts
with comments nested. It never calls `GET /posts/{id}/comments` — it does not
know comments are a separate resource. A comment is added to post 42.

Refetching the feed is not merely wasteful, it is **destructive**: the feed is
ranked, personalized, and cursor-paginated, so refetching reshuffles items
under the user's scroll position. Invalidating `['feed']` is the wrong answer
even if it were free.

Two things are missing, and both are derivable:

1. **Nothing subscribes.** No component mounted the comments contract, so
   subscriptions derived from *mounted queries* never open that topic.
2. **Nothing to write into.** There is no cache entry for the resource — the
   comment belongs at `feedData.posts[3].comments[7]`, nested inside a
   different query's response.

### Embedded-resource map

`GET /feed`'s response is a JSON Schema. When the nested `comments` array
reuses the same schema object that `GET /posts/{id}/comments` returns, a
startup walk over the route table can record a JSON Pointer to every position
where one contract's resource is embedded in another's response:

```
GET /feed  200.body.posts[*].comments  ==  GET /posts/{id}/comments
           200.body.posts[*]           ==  GET /posts/{id}
```

Schema identity finds the *shape*. The remaining piece is the **param
binding** — knowing that `posts[3].id` fills `{id}` to make
`/posts/42/comments`. Default to convention (a path parameter binds to the
sibling property of the same name) and allow it to be stated explicitly
through the existing `x-mjst` vendor extension
(`packages/helpers/src/mjst-extension.ts`), which is already this repo's idiom
for hints JSON Schema cannot express.

Two consequences:

- **Subscriptions derive from data, not from mounted contracts.** When the
  feed's data lands, walking it through the map yields the concrete embedded
  paths — `/posts/42/comments`, `/posts/91/comments`, … — and the client
  subscribes to those *in addition to* `/feed`. The subscription set is the
  union, over live cache entries, of each entry's own resource plus every
  resource embedded in its current value. It self-maintains as pages load and
  are evicted.
- **Events patch in place.** A `comment.created` on `/posts/42/comments`
  does not look for a cache entry that does not exist. The lookup inverts:
  find every cached value that embeds that resource, and splice at the known
  pointer. The feed query is never invalidated, never refetched, never
  reshuffled.

Decomposing the feed into per-entity caches (true normalization) was
considered and rejected: React Query is not a normalized cache, so it would
require a recomposition layer on top and would fight the library throughout.
Patching in place keeps the denormalized value authoritative, needs no new
cache architecture, and structural sharing limits the re-render to the one
post card. If the same resource is embedded in three cached values, it is
patched in three places — cheap and correct.

### The map ships over the handshake

`src/bundler/strip-contract-fields.ts` replaces response `body` schemas with a
bare `true` marker, because the client runtime only checks
`body !== undefined`. **The browser therefore cannot derive this map at
runtime** — the schemas are tree-shaken away in production.

The map is static, so the server computes it at startup and sends it as the
**first event on the stream**. The connection that carries events also carries
the routing table for those events. This is strictly better than deriving it
client-side:

- Zero bundle cost; `stripContractFields` keeps its full value.
- It cannot drift from the server's contracts, because it *is* the server's
  contracts.
- No codegen and no generated file to commit, consistent with `createClient`
  needing none.

## Architecture

```
route contracts
     │
     ├─ createApi({ realtime })     startup, alongside the existing route compile:
     │     │                          ├─ buildResourceGraph()  topic + key derivation
     │     │                          │                        + embedded-resource pointers
     │     │                          └─ PubSub seam           memoryPubSub by default
     │     ▼
     │  mutation succeeds ──► runAfterResponse ──► pubsub.publish(path, event)
     │                        (waitUntil on Workers — off the response path)
     │
     └─ GET /events                 an ordinary route:
           contentType: 'text/event-stream' ──► sseStream(...)
                │
                ├─ first frame: the resource graph
                └─ subsequent frames: { topic, op, seq, payload }
                          │
                          ▼
            createClient({ realtime })   browser:
                ├─ subscriptions ← resources embedded in live cache values
                ├─ applyEvent()  ← pure splice at the mapped JSON Pointer
                └─ gap/resync    ← invalidate, or refetch the narrow contract
```

## Client integration

The realtime machinery is **library-agnostic**: it is logic over contracts and
cached data, with no React and no TanStack in it. It therefore belongs in
`createClient`, which already owns the browser-side contract surface — not in
a separate package.

The seam is a small cache interface, in the same spirit as `RateLimitStore`,
`ValidatorCompiler`, and `BodySerializer`:

```ts
export type ClientCache = {
  readonly read: (key: CacheKey) => unknown | undefined
  readonly write: (key: CacheKey, update: (previous: unknown) => unknown) => void
  readonly invalidate: (key: CacheKey) => void
  /** Live entries — the subscription set is derived from these. */
  readonly keys: () => Iterable<CacheKey>
}
```

`@tanstack/react-query` then becomes a ~40-line adapter the app supplies
(`getQueryData` / `setQueryData` / `invalidateQueries` / `getQueryCache`),
not a dependency of this package. Svelte Query, SWR, and a plain `Map` all
satisfy the same interface, and framework-agnosticism survives intact.

Realtime is **injected, not flag-enabled**, following the principle already
stated for `pathParams` and `serializers` in `src/create-client.ts` — apps
that do not use a capability must not bundle it:

```ts
import { buildParamPath, createClient, createRealtime } from '@amritk/api'

const client = createClient(contracts, '/api', {
  pathParams: buildParamPath,
  realtime: createRealtime({ url: '/events', cache: reactQueryCache(queryClient) }),
})
```

**Behavior worth recording:** because the subscription set derives from live
cache entries rather than component mounts, a resource stays subscribed for as
long as its cached value survives — for React Query, until `gcTime` evicts it.
That is slightly broader than mount-scoped subscription, and mostly desirable
(scrolling back is instant), but it is a real difference and should be
documented rather than discovered.

## Delivery semantics

- **Sequence numbers.** Every event carries a per-topic monotonic `seq`,
  emitted as the SSE `id` field — already supported by `formatSse`
  (`src/sse.ts`). The client tracks last-seen `seq` per topic.
- **Reconnect.** The browser replays `Last-Event-ID` automatically. The server
  holds a short per-topic replay buffer (last N events / N seconds). If it
  covers the gap, replay; otherwise emit a `resync` naming the affected topics.
- **Repair uses the narrow contract.** On a gap, invalidating the *feed* would
  reintroduce the destructive refetch this design exists to avoid. Instead,
  `GET /posts/{id}/comments` exists as a contract even though the app never
  calls it — so recovery fetches that narrow resource and patches it into the
  same pointer. The contract defined for completeness becomes the repair path
  for a query that does not know it exists.
- **Echo suppression.** Events carry an origin id so the client that performed
  the mutation ignores its own echo instead of refetching over its optimistic
  update.
- **Coalescing.** Bursts on one topic batch into a single event per window
  (~250 ms), which matters more for React re-renders than for wire bytes.

## Authorization

Make the topic *be* the permission boundary: subscribing to
`/posts/42/comments` runs that `GET` route's existing guard chain against the
subscribe request. Per-message fan-out then needs no authorization check, and
the rule structurally cannot drift from the read path — the failure mode that
makes hand-rolled socket auth dangerous.

Resources reached through the embedded map are **already authorized by
construction**: the server just served them inside the parent response, so
subscribing to them needs no second guard run (which also avoids ~50 guard
invocations for a 50-post feed).

Revocation remains the open edge: access can be withdrawn while a long-lived
stream is open. Bounded connection lifetime (re-auth on reconnect, which SSE
does natively) is the cheap answer; an explicit revoke event that force-closes
is the thorough one.

## Transport: SSE, not WebSocket

Invalidation and push are both server→client, which is SSE's exact shape, and
for this package the argument is stronger than usual:

- It is plain HTTP, so it flows through `toFetchHandler` and `toNodeHandler`
  unchanged and inherits cookie auth, CORS, and the security middleware
  already shipped. WebSocket upgrade differs on every runtime (`server.upgrade`
  on Bun, `WebSocketPair` on Workers, `ws` on Node, effectively unavailable on
  Next.js serverless) and would fracture the adapter story.
- Reconnect and `Last-Event-ID` resume are in the protocol — exactly the
  missed-message repair this design needs.
- `sseStream` already exists, so the event stream is an ordinary route.

Known limits: the 6-connections-per-origin cap on HTTP/1.1 (moot on HTTP/2,
otherwise shareable across tabs via `BroadcastChannel`), and native
`EventSource` cannot set headers, so bearer-token auth needs a fetch-based
reader built on the streaming primitives already here. WebSocket becomes worth
revisiting only when client→server realtime (presence, typing, cursors) is on
the table.

## Fan-out

The `PubSub` seam mirrors `RateLimitStore`: interface plus `memoryPubSub` in
core, with Redis / Postgres `LISTEN NOTIFY` / Durable Objects supplied by the
app. No new dependency enters `@amritk/api`.

A 50-post feed subscribes to ~50 topics per client, which is fine with pattern
or prefix subscription and bad with naive per-topic fan-out. Above a threshold,
fall back to a single server-derived `user:{id}:feed` channel and let the
server filter. The classic newsfeed hybrid applies: fan-out-on-write for
ordinary posts, direct subscription for hot ones.

## Where derivation stops

Path containment covers containment edges. It cannot know:

- **Ordering** — where a new comment lands in a sorted list.
- **Cross-resource effects** — a comment bumps `commentCount` on
  `GET /posts/{id}` and may reorder `GET /feed` by engagement.
- **Fan-out audience** — "subscribers of this resource" is right for a comment
  thread, wrong for "everyone whose feed contains post 42".

One optional field covers these, taking **typed contract references, not topic
strings**, so renaming a path is a type error rather than a silent break:

```ts
const addComment = defineRoute({
  method: 'post',
  path: '/posts/{id}/comments',
  responses: { 201: { body: commentSchema } },
  affects: ({ params }) => [getPost({ params: { id: params.id } })],
  handler: /* ... */,
})
```

The rule of thumb: code is written only for the non-containment edges, which
in a typical app is a handful of routes rather than all of them.

## Package layout

```
packages/api/src/
  realtime/                     # in '.', no new dependencies, Workers-safe
    build-resource-graph.ts     # route table → topics, keys, embedded pointers
    pub-sub.ts                  # PubSub interface + memoryPubSub
    create-realtime.ts          # event-stream route factory + publish hook
    apply-event.ts              # pure splice — shared by client and tests
```

Nothing lands in `./bundler` or `./dev`; both remain one-way entries so
`node:fs` never reaches the graph that ships to Workers and browsers. No
`@amritk/api/query` subpath — the cache seam removes the need for one, and
with it the widening of this package's scope into frontend-framework surface.

## Engine parity

The resource graph is static, so it follows the OpenAPI document's existing
treatment: built once at startup by `createApi`, and precomputed at build time
as string constants by `compileToModule` — runtime cost is a map lookup.

The differential corpus extends naturally: same contracts, same mutations,
both engines must emit byte-identical events. That keeps realtime inside the
existing observational-equivalence guarantee instead of bolting on an untested
second path.

## Roadmap / open questions

- **Phase 1 — the floor.** `PubSub` seam + `memoryPubSub`, resource-graph
  derivation, the event-stream route, publish-on-mutation via
  `runAfterResponse`, invalidation-only delivery, `seq` + replay + resync.
  Hard to retrofit; everything else layers on top.
- **Phase 2 — push.** Payload events reusing the mutation's success response
  schema, `applyEvent` splice semantics from the HTTP method, echo
  suppression, coalescing.
- **Phase 3 — embedding.** The embedded-resource map, data-derived
  subscriptions, narrow-contract repair.
- **Phase 4 — parity.** Compiled-engine constants and differential cases.
- **Compression interaction.** `createCompression` must skip
  `text/event-stream`; a compressor that buffers silently breaks streaming.
  Needs verifying either way before Phase 1 ships.
- **Hot reload interaction.** `createHotApi` (`./dev`) swaps the build
  atomically while "keeping the socket and process state", but long-lived
  streams are held by the *old* build's handler. Dropping streams on reload and
  letting clients reconnect through the existing resync path is probably right
  — but it is a deliberate choice, not a detail.
- **Debuggability.** Derived behavior is harder to diagnose when wrong. A
  `realtime: { debug: true }` mode that logs the derived topic, key, and
  operation per event — plus a startup dump of the resource graph — turns "why
  didn't my comment appear" into a log line rather than an excavation. The
  graph should also be assertable in tests.
- **Param-binding inference.** Convention (path param binds to the sibling
  property of the same name) covers the common case; the `x-mjst` escape hatch
  covers the rest. Whether inference should be opt-in rather than default is
  unresolved — a wrong binding fails quietly, which argues for explicitness.
- **Ordering hints.** Where a pushed item lands in a sorted collection is not
  derivable. Client-side re-sort is the fallback; a declared sort key on the
  collection contract is the tighter answer, and is not designed yet.
