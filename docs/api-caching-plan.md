# Plan: Contract-Declared Caching (`@amritk/api`)

## Goal

Cache `@amritk/api` responses at Cloudflare's edge, and guarantee that a
cached response is **never served after the resource behind it changed**.

The second half is the hard half. Edge caching is a solved, commodity problem;
"the cache is never stale" is a distributed-systems claim, and most systems
that advertise it are quietly making a weaker one. This document says exactly
which claim we make, what it costs, and where the boundary is.

## Prior art: how the field actually invalidates

Two schools, and everything popular is one of them or a blend.

### School A — invalidation-based (purge / ban / tag)

The cache key is stable (`/posts/123`). On a write, you tell the cache to
*remove* the entry.

| System | Mechanism | Notes |
|:--|:--|:--|
| **Varnish** | `purge` (immediate, exact key), `ban` (lazy, regex over object metadata), `xkey` vmod | The origin of tag-style invalidation. Bans are cheap to issue, expensive to evaluate — the ban list is walked on lookup. |
| **Fastly** | `Surrogate-Key` response header, many-to-many; hard purge and **soft purge** (mark stale, keep serving under `stale-while-revalidate`) | Varnish-derived. The soft/hard distinction is the important idea: soft purge trades freshness for availability *deliberately*. |
| **Akamai** | `Edge-Cache-Tag`, Fast Purge, CP codes | Same shape, different names. |
| **Cloudflare** | `Cache-Tag` response header + purge by tag / prefix / hostname / URL | Historically Enterprise-only; **all purge methods went to all plans in April 2025**. |
| **Next.js / Vercel** | `cacheTag()` + `revalidateTag()` | Explicitly *soft*: `revalidateTag` marks entries stale and the refresh happens on next visit. Stale-while-revalidate by design. |
| **Redis / Memcached** | `DEL` on write, or pub/sub fan-out to app-tier caches | The tag layer is something you build (a set per tag holding member keys). |

### School B — key-based ("generational", "Russian doll")

You never invalidate. The version is *in the key*, so a write makes the old
entry unreachable rather than wrong.

| System | Mechanism |
|:--|:--|
| **Rails** | `cache_key_with_version` → `posts/123-20260811193020`. Writes touch `updated_at`; the old key is simply never requested again and ages out by LRU. Nested fragments make this "Russian doll caching". |
| **Static assets everywhere** | Content-hashed filenames (`app.9f3c1e.js`) + `Cache-Control: immutable`. The most widely deployed never-stale cache in existence. |
| **Redis namespace versioning** | `INCR ns:user:1:gen`, then key on `user:1:v{gen}:profile`. |
| **Facebook memcache leases / TAO** | Leases exist specifically to stop *stale sets* — see G2 below. Worth knowing that a company at that scale needed a dedicated mechanism for it. |

School A is fast and cheap and eventually consistent. School B is strictly
correct and costs you a version read before you can even form the key.

**Nobody gets never-stale from School A alone.** That is the central finding.

### The two gaps School A cannot close

**G1 — propagation lag.** A purge is a message to a global fleet. Between
"the write committed" and "every tier has dropped the entry" there is a
window. Cloudflare does not publish a propagation SLA for tag purge, so we
must treat it as *measured, not guaranteed*.

**G2 — the stale set (the write race).** This is the one people forget, and
no amount of purge ordering fixes it:

```
t0  read R misses cache, Worker runs, reads post 123 (version 1)
t1  write W commits post 123 → version 2
t2  W issues purge(post:123)   → cache is now empty. Correct!
t3  R's response (version 1) finishes and is written into cache
t4  every subsequent reader gets version 1, forever, until TTL
```

The purge happened *between* the read's data fetch and the read's cache
write, so it removed nothing and prevented nothing. The cache is now
indefinitely stale with no pending invalidation to fix it. This is the
failure mode that makes "we purge on write" an unsound never-stale claim,
and it is exactly what memcache leases were invented for.

## The platform: Cloudflare Workers Caching

Cloudflare shipped a Workers-native cache that is a much better fit than the
legacy `caches.default` Cache API. Facts that drive the design:

- **Enabled in config** — `"cache": { "enabled": true }` in `wrangler.json`.
- **RFC 9111 semantics** — cacheability is driven by ordinary `Cache-Control`,
  including **heuristic freshness for responses that set no directives at
  all**. This is a footgun and dictates our default (below).
- **The cache key** is `entrypoint + path + query string + Worker version +
  ctx.props`. It does **not** include the host, the method (GET and HEAD
  share an entry), or any request header. Query parameter *order* matters —
  `?a=1&b=2` and `?b=2&a=1` are distinct keys.
- **Tiered by default** — lower tier near the eyeball, upper tier aggregating
  fills. No configuration.
- **Request collapsing** — concurrent requests for one key run the Worker
  **once**. The legacy Cache API has no such thing. This meaningfully narrows
  G2's window (fewer concurrent in-flight reads to lose a race with) but does
  not eliminate it.
- **`ctx.cache.purge({ tags, pathPrefixes, purgeEverything })`**, also
  importable as `cache.purge` from `cloudflare:workers` — which matters to us,
  because a framework adapter should not have to thread `ctx` through its
  internals. Tags come from the `Cache-Tag` response header.
- **Purge is scoped to the calling entrypoint.** Not the zone. A zone-level
  purge (dashboard, API, Terraform) does *not* touch Workers Caching content,
  and one entrypoint cannot purge another's.
- **Only GET/HEAD are cached.** 206 and 520–526 never cache. Responses with
  `Set-Cookie` and requests with `Authorization` bypass.
- **Tag limits** — ≤1000 tags per response, ≤1024 chars per tag, ≤16 KB of
  aggregate `Cache-Tag` header, printable ASCII with no spaces.
- **Purge rate limits are the binding constraint.** Purge shares the zone
  purge limiter: **Free 5 requests per *minute***, Pro 5/s, Business 10/s,
  Enterprise 50/s, with ≤100 operations per call (500 on Enterprise) and
  token-bucket bursting. A naive purge-per-mutation design is dead on arrival
  on Free and marginal on Pro. **Batching is not an optimization here, it is
  a requirement.**
- **No pre-warming.** A response is only cached after it has been served once.

Legacy `caches.default`, for contrast: `cache.delete()` is **colo-local
only**, and a URL cached under a custom cache key cannot be purged by URL at
all. We should not build on it.

## Strategy

### Principle: the invalidation graph is part of the contract

`@amritk/api`'s whole thesis is that a route declares itself once and the
framework derives everything else — types, validators, OpenAPI, client.
Caching should be no different. Today the dependency between "this read is
cacheable" and "this write invalidates it" lives in a developer's head, which
is precisely why caches go stale in every codebase.

So: **read routes declare what their response is made of; write routes
declare what they change.** One declaration, four derived outputs — the
`Cache-Tag` header, the `Cache-Control` header, the `purge()` call, and an
OpenAPI `x-cache` extension. And, uniquely available to us because it is
declared data rather than imperative code: **a build-time check that the
graph is closed.**

### The surface

```typescript
const getPost = defineRoute({
  method: 'get',
  path: '/posts/{id}',
  cache: {
    tags: ['post:{id}', 'post:list'],   // templates over validated params
    maxAge: 300,
    scope: 'public',
    freshness: 'purge',                 // 'purge' (default) | 'strict'
  },
  responses: { 200: { body: PostSchema }, 404: {} },
  handler: /* … */,
})

const updatePost = defineRoute({
  method: 'patch',
  path: '/posts/{id}',
  invalidates: ['post:{id}', 'post:list'],
  responses: { 200: { body: PostSchema }, 404: {} },
  handler: /* … */,
})
```

Note `cache.tags` is nested — the top-level `tags` field is already the
OpenAPI grouping tag and must keep that meaning.

**Tags are templates, not closures.** `'post:{id}'` interpolates from the
already-validated, already-coerced `params`. This is the load-bearing design
choice, and it buys four things a `(ctx) => string[]` callback cannot:

1. It is **data**, so it hashes into the existing contracts hash, serializes
   into the compiled module, and embeds in the OpenAPI document.
2. It is **comparable across routes**, which is what makes the static check
   possible.
3. It compiles to inline string concatenation in `compileToModule` — the
   whole feature costs one header set on the hot path.
4. It cannot accidentally depend on unvalidated input or on the response body,
   so a tag can never be a function of something the cache key does not cover.

Escape hatch for collection endpoints that genuinely need per-member tags
(`GET /posts` tagging `post:1 … post:99` so that creating post 100 does not
require a coarse list tag): `tagsFrom: (reply) => string[]`, which marks the
route `unchecked` and excludes it from the static check, with the 1000-tag
cap enforced at runtime. The default guidance stays the coarse `post:list`
tag — slightly over-invalidating, trivially correct, and statically checkable.

### Hierarchies: cascade on read, not on write

Real resources nest — a post belongs to an author belongs to an org, and the
author page and the org dashboard both embed the post. Changing the post has
to bust all three.

The instinct is to walk the parent graph when the write lands and issue a
purge per ancestor. That is backwards: it needs graph knowledge on the write
path, and it spends N purge calls against a limiter that allows five per
*minute* on Free.

Invert it. **Every cached response is tagged with every entity it contains, at
every level.** Tags are many-to-many, so one flat purge fans out for free:

```
GET /posts/123        → Cache-Tag: post:123, post, author:9, org:4
GET /authors/9        → Cache-Tag: author:9, author, post:123, post:456, org:4
GET /orgs/4/dashboard → Cache-Tag: org:4, author:9, author:22, post:123, …

PATCH /posts/123 → purge({ tags: ['post:123'] })
   ↳ busts /posts/123, /authors/9, and /orgs/4/dashboard — in one call
```

The author page is invalidated because *it declared that it contains post
123*, not because anything traversed upward at write time. This is what
Fastly surrogate keys and Rails' Russian-doll caching actually do. Both
directions collapse into the same mechanism: rename org 4 and every post
response already carries `org:4`, so purging that one tag reaches all of them.

#### Busting a whole entity type

Emit a bare type tag beside the id tag — `post:123` **and** `post`. Purging
`post` reaches every post-bearing response, at the cost of one extra tag per
response and no machinery at all.

`purge({ pathPrefixes: ['/posts'] })` is the alternative, and is genuinely
useful when the URL structure mirrors the entity hierarchy (`/orgs/4/…` takes
out a subtree in one operation; tags and prefixes combine in a single call).
But it invalidates by URL rather than by content, so a `/feed` that embeds
posts escapes it. Tags are the accurate instrument, prefixes the blunt one.

#### Bulk uid purges collapse to the parent

`post:123` is the base case. The constraint is roughly 100 tags per purge
call against the rate limits above — five hundred uids is five calls, which
on Free is the entire minute. The coalescer therefore needs a threshold rule:
**above N distinct child tags, purge the type tag instead.** Over-invalidating
every post is one operation; enumerating them is five hundred.

#### Four constraints that shape the tag vocabulary

1. **Hierarchical tag *strings* do not give prefix purge.**
   `org:4:author:9:post:123` looks like a tree and is not — tag purge is exact
   string match and there is no `org:4:*`. Emit several flat tags instead.
   This is the most common way to get hierarchical invalidation wrong.
2. **Ancestor tags usually cannot come from params.** `/posts/{id}` does not
   know the author id until it has loaded the post. Templates cover
   `post:{id}`; ancestors need the data — which is why handler-returned tags
   are a required part of a hierarchical design rather than an escape hatch.
3. **Re-parenting needs both sides.** Moving post 123 from author 9 to author
   22 must purge `author:9` *and* `author:22`, and the old parent is only
   knowable by reading before the write. Handler-returned invalidations,
   mirroring handler-returned tags.
4. **Collections blow the tag cap.** 1000 tags and 16 KB per response. A feed
   of 200 posts with three ancestors each is 600 tags — it fits, barely. The
   rule is *high fan-in, coarsen*: tag large collections with the type tag
   rather than enumerating members.

#### Why not declare the entity graph

`defineEntityGraph({ post: { parents: ['author'] } })` is appealing, but the
framework cannot expand `post:123` into `author:9` without reading data it has
no access to. The graph is worth having as a lint (does every emitted tag have
a purger, and vice versa — a write tag no read ever emits is a silent no-op
that still costs rate limit) and as a generated report. It is not a runtime
mechanism. Same conclusion as the cache manifest: an output, not an input.

### Default deny

A route with no `cache` block emits `Cache-Control: no-store`.

This is not paranoia. Workers Caching applies **RFC 9111 heuristic freshness**
to responses that declare nothing, so silence means "cache it for a while
using a guess". Any framework that does not close this by default will
eventually serve someone's account balance to someone else. Opting *in* to
caching is a one-line declaration; opting out has to be the thing you get for
free.

### The second axis: who the response varies by

Tags answer *when a response stops being true*. They say nothing about *who is
allowed to see it*, and a caching design that models only the first axis is
not merely incomplete — it leaks.

Cloudflare's cache key is `entrypoint + path + query + Worker version +
ctx.props`. **No request header and no cookie is part of it.** There are two
automatic bypasses: requests carrying `Authorization`, and responses carrying
`Set-Cookie`. Bearer-token APIs are therefore safe by accident. Cookie
sessions — which this package supports directly (`signCookie`,
`buildCookiesObject`, `createCsrf`) — are not:

```
Alice → GET /me  (Cookie: session=alice)  → Worker runs, returns Alice's profile
                                          → no Set-Cookie, so it caches under "/me"
Bob   → GET /me  (Cookie: session=bob)    → cache HIT → Bob receives Alice's profile
```

`Cookie` is not in the key and does not trigger the bypass; only `Set-Cookie`
on the way out does. So the safety net holds only while every response happens
to set a cookie. A session layer that refreshes a rolling cookie *only near
expiry* flips the same route from bypassed to cached with no code change.
Safety contingent on a header being intermittently present is not safety.

#### Scopes

- **`public`** — shared edge cache. Legal only when the contract declares no
  identity input.
- **`private`** — `Cache-Control: private`. Browser cache only, never the
  shared edge. Correct for `/me`; still wins on back/forward and repeat
  navigation, and costs nothing.
- **`none`** (default) — `no-store`.

#### The scope is derived, not trusted

Default deny does not cover this, because the hazard is someone opting *in* on
a route that turns out to be per-user. But the contract already knows the
answer: a route that declares `security`, carries `securityGuards`, or reads
an auth-bearing entry in `request.headers` / `request.cookies` has *declared*
that its response depends on the caller.

So **`scope: 'public'` is a build error on any such route** — the same
structural move as the tag-closure check, aimed at the leak instead of the
staleness. The developer cannot assert their way past it; they either drop to
`private` or split the route.

#### Splitting is the real technique

Most routes in a real API are neither wholly public nor wholly personal —
they are a large shared core with a thin per-user decoration (`/posts/{id}`
carrying a `viewerHasLiked`). The answer is to split: `GET /posts/{id}` public
and cached, `GET /posts/{id}/viewer` private and uncached, composed by the
caller. The typed client makes two calls cheap, and this is where nearly all
of the achievable edge-cache win on an authenticated API actually lives.

#### Not `Vary: Cookie`

It looks like the correct fix and is a trap. Every distinct cookie value
becomes a distinct cache entry, so the hit rate collapses to approximately
zero, and it relocates per-user data into a shared cache where a single
`Vary` misconfiguration becomes a breach. `Vary` is for content negotiation
(`Accept`, `Accept-Encoding`), not for identity.

#### Honest sizing

If an API is predominantly authenticated and nothing splits cleanly into a
shared core, this feature buys very little at the edge and the effort belongs
in an origin-side cache instead. Whether it is worth building is a question
about the actual route table, and should be answered by counting genuinely
public routes before any of this ships.

### The freshness tiers

**Tier 0 — uncached (default).** `no-store`. Never stale because never
cached. Costs nothing, guarantees everything.

**Tier 1 — `freshness: 'purge'`.** Tag on read, purge on write. Fast, cheap,
covers the overwhelming majority of real routes. Three things make it
materially stronger than the usual implementation:

- **The purge is awaited before the write's response returns**, by default.
  A user who just submitted a form and immediately reloads must not see their
  own pre-write data — read-your-writes is the staleness users actually
  notice. `purge: 'background'` moves it to `waitUntil` (we already have
  `runAfterResponse` for exactly this) for people who would rather have the
  latency, but they have to ask.
- **A delayed second purge closes G2.** After the immediate purge, schedule a
  second purge of the same tags ~N ms later via `waitUntil`. Any stale entry
  written by a read that was in flight across the commit gets evicted, and
  the staleness window becomes *bounded by N* instead of *bounded by TTL*.
  With request collapsing already narrowing the race, this is the pragmatic
  answer, and it is honest about being a bound rather than a proof.
- **A failed purge is loud.** `purge()` returns `{ success, errors }` and
  rate-limit rejections come back that way rather than throwing. Swallowing
  that is the difference between a cache that is bounded-stale and one that
  is silently, permanently wrong. Failures go to `onError` with the tag list
  intact, and get retried.

**Tier 2 — `freshness: 'strict'`.** Never stale by construction, School B.
The framework prefixes the cached URL with a generation token
(`/posts/123?__g=7`) — the query string is part of the key and order-sensitive,
so this works with no custom-cache-key machinery. A write **bumps the
generation atomically before returning**. The old key is unreachable the
instant the bump commits: no propagation window (G1 gone) and an in-flight
read writes its stale response to the *old* key, where nobody will ever look
for it (G2 gone). Old entries age out by TTL as garbage.

The generation counter lives in a **Durable Object** — the only strongly
consistent primitive on the platform. KV cannot serve this role; up to 60
seconds of eventual consistency is exactly the staleness we are trying to
eliminate.

**The honest cost, stated plainly:** strict mode puts a strongly consistent
read on the request path, in front of the cache, where the cache tier cannot
absorb it. Mitigations — one DO per tag *namespace* rather than per resource,
batched generation reads, an isolate-memory memo — all help throughput, but
the memo window *is* your staleness bound. `memoMs: 0` gives a true zero and
pays a DO round trip per request; `memoMs: 1000` gives a one-second bound for
nearly free. We should expose that number rather than hide it, because it is
the actual guarantee.

### Tier summary

| | Tier 0 | Tier 1 `purge` | Tier 2 `strict` |
|:--|:--|:--|:--|
| Staleness bound | none (uncached) | purge propagation + N ms | `memoMs` (0 = never stale) |
| G1 propagation lag | n/a | bounded, undocumented by CF | eliminated |
| G2 stale set | n/a | bounded by delayed second purge | eliminated |
| Request-path cost | none | none | one DO read (memoizable) |
| Write-path cost | none | 1–2 purge calls | one DO write |
| Rate-limit exposure | none | **yes — the real constraint** | none |

### Purge batching

Given Free-plan limits of five purge calls **per minute**, per-mutation
purging cannot be the transport. The design needs a coalescer: buffer tags
over a short window, deduplicate, and flush one `purge()` call carrying up to
100 tags. Per-isolate buffering is trivial and gets most of the win; globally
correct coalescing wants a Durable Object, which is the same primitive Tier 2
already requires. Both paths must surface rate-limit rejections rather than
dropping them.

### Two details this repo already has the right pieces for

**Keep Cloudflare's Worker-version cache epoch — do not swap in the contracts
hash.** Cloudflare puts the Worker version in the cache key by default, so
every deploy is a total implicit purge. It is tempting to narrow that to
`hashContracts()`, which we already compute, on the theory that the cache
should only bust when the contract changed. That is wrong, and the reason is
worth writing down.

The two hashes answer different questions. The Worker version identifies the
deployed *code*; the contracts hash identifies the *wire contract*, and
`hash-contracts.ts` deliberately excludes handler, `refine`, and guard
**bodies** — it records only their presence. That exclusion is right for the
job it was built for (the compiled module imports those functions and calls
them live, so rewriting one must not make a build stale) and fatal for a
cache epoch.

A cached response is a function of handler code, guard code, backing data,
and the request. The contracts hash covers the *type* of the response, not
its *value*. Fix a bug in a handler — wrong field, corrected query, identical
schema — and the contracts hash does not move, so every response cached from
the buggy code keeps serving until TTL. That is the silent staleness this
whole document exists to prevent.

Worker version is a superset of what is needed: it over-invalidates, which is
safe. The contracts hash is a subset: it under-invalidates, which is not.
The cost of the blunt instrument is smaller than it looks, because tiered
cache and request collapsing mean a cold key costs one origin fill across the
whole network rather than a herd. And there is no cheaper *correct* epoch on
offer — anything narrower would have to prove handler behaviour unchanged,
which is not decidable in general.

**The contracts hash does have a job here, just a different one.** When
`cache` and `invalidates` land on the contract they must be added to
`contractFields`. Otherwise we reproduce exactly the bug documented in that
file's own comments about guards: a compiled module emitting the *old*
`Cache-Tag` header against edited tag templates, with nothing to catch it.
It is a build-staleness detector, not a cache epoch.

**`createETag` composes underneath.** The edge cache handles the origin hop;
ETag plus `If-None-Match` handles the last hop to the browser and turns a
revalidation into a bodyless 304. They are complementary, not alternatives.

### Keep it portable

`@amritk/api` is framework- and platform-agnostic by design, and the caching
layer must not quietly make Cloudflare mandatory. The contract fields
(`cache`, `invalidates`) are pure data and stay in the browser-safe graph; the
execution side goes behind a small driver seam:

```typescript
type CacheDriver = {
  readonly tagHeader: (tags: readonly string[]) => Record<string, string>
  readonly purge: (tags: readonly string[]) => Promise<PurgeResult>
}
```

Cloudflare Workers is the first driver (`Cache-Tag` + `cache.purge`). A
Fastly driver is a near-exact rename (`Surrogate-Key` + the purge API). Node
and development get an in-memory driver. Same contract, different backends —
the same split the runtime and compiled engines already live under.

## Open questions

1. **Purge propagation, measured.** Cloudflare publishes no SLA for tag-purge
   propagation across tiers. Tier 1's guarantee is only as good as this
   number, so it needs measuring on a real zone before we write a bound into
   the docs — and the delayed-second-purge default N should be derived from
   the measurement, not guessed.
2. **Deploy-time hit-rate loss.** Settled in favour of keeping the Worker
   version as the epoch (see above), so this is no longer a design question —
   but it is worth measuring how much hit rate a deploy actually costs on a
   real workload, since that number is what a future argument for something
   narrower would have to beat.
3. **Per-user edge caching via `ctx.props`.** `ctx.props` *is* part of the
   cache key, so a genuinely per-user shared-cache partition is possible — but
   only for Workers invoked over a service binding or RPC, not a plain
   `fetch`. Worth scoping once the public-route case works; the `private`
   scope covers the need until then. (The safety rules for per-user responses
   are settled — see "The second axis" — this is only about whether we also
   offer edge caching for them.)
4. **Static check severity.** A read tag that no write route invalidates is a
   permanently stale resource — almost certainly a build error rather than a
   warning, but it needs an explicit `unchecked` escape hatch for tags
   invalidated out of band (a cron, a webhook, another service).
5. **Where the check runs.** `checkCacheGraph(routes)` inside `compileToModule`
   is the natural home, but this repo also owns a linter, and a
   `mjst lint`-visible finding with a `file:line:col` would be strictly better
   developer experience.

## Sources

- [Workers Caching](https://developers.cloudflare.com/workers/cache/)
- [Purging the cache (`ctx.cache.purge`)](https://developers.cloudflare.com/workers/cache/purge/)
- [Workers Cache keys](https://developers.cloudflare.com/workers/cache/cache-keys/)
- [Workers Cache limitations](https://developers.cloudflare.com/workers/cache/limitations/)
- [How the Cache works (legacy Cache API)](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)
- [Purge by cache tags](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/)
- [Purge availability and limits](https://developers.cloudflare.com/cache/how-to/purge-cache/)
- [All cache purge methods now available for all plans (Apr 2025)](https://developers.cloudflare.com/changelog/product/cache/)
- [Fastly surrogate keys](https://www.hward.com/varnish-cache-invalidation-with-fastly-surrogate-keys/)
- [Next.js `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
