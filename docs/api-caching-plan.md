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

### School C — automatic (dependency tracking, no declared invalidation)

Neither school above removes the human from the loop; both ask someone to
name what changed. A third lineage does not.

| System | Mechanism |
|:--|:--|
| **Django `cachalot`** | Patches the ORM, caches every SELECT, and invalidates by tracking which *tables* a query touched. Table-granular and zero-configuration. |
| **Shopify `identity_cache`, Laravel model-caching** | Invalidate off model lifecycle callbacks rather than explicit purges. |
| **Apollo / Relay normalized caches** | The client records which entity ids a query returned and updates them when a mutation returns the same ids. Automatic on the read path, same shape as tracking. |
| **RTK Query** | `providesTags` / `invalidatesTags` — the *manual* incarnation, and the thing this design deliberately does not copy. |
| **Noria** (MIT, OSDI 2018) → **ReadySet** | Subscribes to the Postgres WAL / MySQL binlog, compiles each cached query into a partially-stateful dataflow graph, and incrementally updates results as rows change. |
| **Materialize** | Incremental view maintenance over a CDC stream. |

The pattern in that list is worth reading carefully: **the fully automatic
systems all live at the database, and that is not a coincidence.** The
replication stream is the only authoritative record of everything that
changed. Everything implemented above the database is automatic only for
writes that happen to pass through it.

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

### Principle: nobody writes a tag

`@amritk/api`'s thesis is that a route declares itself once and the framework
derives the rest. Applied naively to caching, that suggests per-route tag
declarations: reads declare what they are made of, writes declare what they
change. That is where an earlier draft of this document landed, and it is
wrong for the same reason every tag-based cache eventually goes stale — a
declaration records what the author *believed* the handler reads, and a cache
goes bad in the gap between that belief and what the code actually did.

The tags do not disappear; Cloudflare's purge substrate is tag-based and that
is not negotiable. What is negotiable is whether a human ever types one. The
relationship is an ORM's to SQL: still executed, never authored.

So the invalidation graph is **observed rather than declared**, on both sides:

- A **read** through the tracked store records the entities it touched. Those
  become the response's `Cache-Tag` set.
- A **write** through the same store records the entities it changed. Those
  become the `purge()` call.

Both sides derive their keys from one key function per entity, so they cannot
disagree. "A tag nobody purges" stops being a bug class rather than becoming
an unchecked one — structural beats checked.

The declaration cost drops by an order of magnitude with it. Per-route tags
cost O(routes × ancestors) hand-written strings; entity keying costs
O(entities). That last figure is irreducible — nothing but you can say what
makes a row *that row* — but it is one line per type, and it is knowledge you
already have.

### The surface

One store, wrapping the data layer that already exists. No classes — the
package rule is one function per file and functional paradigms
(`.claude/typescript.md`), so this is the same closure-bound factory form as
`createApi`, `createETag`, and `createClient`.

```typescript
const cache = createCacheStore({
  driver: cloudflareDriver(),
  entities: {
    post: (row) => `post:${row.id}`,
    author: (row) => `author:${row.id}`,
  },
})

const api = createApi({
  routes,
  context: ({ executionContext }) => ({ db: cache.track(db, executionContext) }),
})
```

`db.posts.find(123)` records a dependency on `post:123`. `db.posts.update(123,
…)` records a mutation and purges it on commit. Neither the read route nor the
write route says anything about caching.

What remains on the contract is only what the store cannot know: whether the
route may be cached at all, and for whom.

```typescript
const getPost = defineRoute({
  method: 'get',
  path: '/posts/{id}',
  cache: { scope: 'public', maxAge: 300, freshness: 'tagged' },
  responses: { 200: { body: PostSchema }, 404: {} },
  handler: /* … */,
})
```

Note `cache` is a nested object — the top-level `tags` field is already the
OpenAPI grouping tag and must keep that meaning, which is a second reason not
to put cache tags on the contract at all.

Wrapping an arbitrary data layer generically is the hard engineering here, and
the honest answer is one adapter per store — Drizzle, Kysely, raw SQL — which
is the shape `@amritk/adapters` already solves for schemas.

### Package boundary

The tracking core is HTTP-agnostic: record what a unit of work read and wrote,
produce a key set, hand it to a driver. It is equally useful from a queue
consumer, a cron, or an SSR render, and `@amritk/api` keeps exactly one
runtime dependency by design. So it splits the way this repo already splits
things:

- **`@amritk/cache`** — dependency tracking, the key vocabulary, drivers
  (Cloudflare, Fastly, in-memory), purge coalescing, shadow auditing. No HTTP.
- **`@amritk/api/cache`** — the thin seam: context wiring, `Cache-Tag` and
  `Cache-Control` emission, scope derivation from `security` /
  `request.headers` / `request.cookies`, and the dev-mode audit.

The same relationship `runtime-validators` has to `lint` and `api`, and that
`@amritk/lint` core has to `@amritk/lint/rules/openapi`.

### What is lost by not declaring

Worth stating plainly rather than discovering later. The static closure check
goes away — with tags observed at runtime there is nothing to compare at build
time. That is an acceptable trade because the bug it caught is now impossible
by construction rather than merely detected, but two smaller losses are real:
cache behaviour no longer self-documents in the OpenAPI document, and tag
templates no longer inline into the compiled module (the tag set is built per
request from the tracked reads). Neither is fatal; both are regressions
against the earlier draft and should not be rediscovered as surprises.

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
2. **Ancestor tags cannot come from the route.** `/posts/{id}` does not know
   the author id until it has loaded the post, so no declaration on the
   contract could supply it. The tracked store gets this right for free —
   loading the author *is* what records `author:9` — and it is the clearest
   argument that observation has to be the source of tags rather than a
   fallback for the cases declaration cannot reach.
3. **Re-parenting needs both sides.** Moving post 123 from author 9 to author
   22 must purge `author:9` *and* `author:22`. The old parent is only knowable
   by reading before the write, which the store captures on the way past
   provided the handler reads before it updates.
4. **Collections blow the tag cap.** 1000 tags and 16 KB per response. A feed
   of 200 posts with three ancestors each is 600 tags — it fits, barely. The
   rule is *high fan-in, coarsen*: tag large collections with the type tag
   rather than enumerating members.

### The dependency graph: observed, not declared

The tag set on a response *is* a dependency edge list, and Cloudflare
maintains the inverted index from tag to cache entry. So the graph already
exists; the only question is where its edges come from. There are two
candidates, and they are not interchangeable:

- **The type graph** (static) — `post → author → org`. Which *kinds* of entity
  depend on which. Declarable at build time.
- **The instance graph** (dynamic) — `post:123 → author:9 → org:4`. Which
  *specific* entities depend on which. Knowable only from data.

A declared type graph cannot expand `post:123` into `author:9`; the framework
has no data access. But that is an argument against *declaration*, not against
a runtime graph — and the runtime option is the stronger of the two.

#### Why declaration is the wrong source

Rank how a cache actually goes bad:

| failure | caught by a declared graph? |
|:--|:--|
| **Missing tag** — the response read entity X and never tagged X | **no** |
| Missing purger — a tag is emitted that no write route purges | yes (closure check) |
| Drift — read emits `post:123`, write purges `posts:123` | yes |
| Stale set, propagation lag, purge failure | n/a — covered above |
| Re-parenting — the old parent is never purged | partly |

The first row is the one that produces permanent staleness in the field, and
declaration is powerless against it. Declaring that a post depends on an
author does nothing if the handler never emits `author:9`. Declarations record
intent; bad caches live in the gap between intent and what the code actually
read.

#### Derive tags from data access

```typescript
const api = createApi({
  routes,
  context: ({ executionContext }) => ({
    db: trackDependencies(db, executionContext),
  }),
})
```

Every `db.post(123)` records `post:123`, every `db.author(9)` records
`author:9`, and the framework emits the union as `Cache-Tag` when the response
is built. The handler is never asked to remember its dependencies, so it
cannot forget them — missing tags become structurally impossible for anything
that flows through the tracked accessor.

This is where the mature systems converge: Next.js attaches `cacheTag()`
during render, normalized client caches record the ids a query touched, TAO
records the association on read, and Rails' nested `cache` block *is* the
dependency record. None of them ask the author to restate it.

Two consequences worth naming:

- **Re-parenting resolves itself** when the write handler reads before it
  updates — the accessor captures the old parent on the way past.
- **Negative caching needs misses recorded too.** A 404 for `post:999` depends
  on post 999 *not* existing, so the accessor must record the key it looked
  for even when it finds nothing, or creating that post will never bust the
  404.

The declared type graph keeps a role, demoted to **verifier**: assert in
development and tests that the observed tag set matches the declared shape.
Declaration checks observation; observation produces the tags. It also still
drives the closure lint (every emitted tag has a purger; every purged tag has
an emitter — a write tag no read ever emits is a silent no-op that still
spends rate limit) and the generated cache-graph report.

#### Out-of-band writes, and the CDC tier

An instrumented store is automatic for writes that pass through it. It is
blind to a migration, an admin panel, a second service sharing the database,
or a human in `psql` — each of which produces a permanently stale cache with
no purge issued and no error raised. This is the failure mode that School C's
database-resident systems exist to solve, and no amount of application-level
instrumentation reaches it.

So the guarantee has two tiers:

1. **Instrumented store** — automatic for application writes. Covers the
   overwhelming majority, and needs nothing beyond the store wrapper.
2. **Change-data-capture feed** — Postgres logical replication (or the MySQL
   binlog) into a Worker that maps changed rows to keys through the *same*
   entity key functions, and purges. Covers every write, whatever made it.

Tier 2 is what makes "you never bust a cache" literally true rather than true
for well-behaved callers, and it is a clean seam: just another producer of
purge calls, with no contract involvement and no request-path cost. It should
be optional — plenty of deployments have no out-of-band writers — but the
design must leave room for it rather than assume the application is the only
writer.

#### Where "never bad" actually ends

Tracking makes entity-keyed reads safe. It does not make everything safe, and
the honest design refuses to cache the rest rather than pretending:

- **Aggregates.** "47 posts this week" depends on a query, not an entity —
  there is no id to tag. Coarsen to the type tag and purge on any write of
  that type, or leave it uncached.
- **Time windows.** "The last hour" depends on the clock. No tag can express
  it; only a TTL bounds it.
- **List membership.** `/posts?page=1` depends on which posts exist and in
  what order. Member tags do not cover *the set* — that needs the collection
  tag.
- **Untracked reads.** Raw SQL, a `fetch()` to another service, a handler's
  own memo. Invisible to the tracker, and therefore invisible to invalidation.

The last one has a type-level answer that fits this package's grain: a
cacheable route's context exposes **only** the tracked handle, so reaching for
the raw client is a type error rather than a code-review note.

#### Prove it: shadow auditing

Design buys correctness for the failure modes we modelled. Nothing buys
unknown-unknowns except measurement. Sample a small fraction of cache hits,
re-run the handler under `waitUntil`, and diff the result against what was
served; on a mismatch, log loudly, purge the entry, and alert.

That turns "never stale" from a claim into a measured error rate with a
dashboard behind it, and it is the only mechanism here that catches a
dependency nobody thought to model. It costs a few percent of origin traffic.
Given that the whole document is built around a guarantee, it should be
treated as part of the feature rather than an operational extra.

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

### The cachalot model, and the one part that does not port

Cachalot is the closest working precedent, so it is worth stating precisely
what it does:

1. Every SELECT is cached under a key derived from the SQL text and params.
2. The compiler already knows **which tables** the query touches, so the entry
   records that set.
3. A **per-table invalidation timestamp** lives in the same cache.
4. A write to a table sets that table's timestamp to now. **Nothing is
   deleted.**
5. A read fetches the entry *and* its tables' timestamps in one `get_many`,
   and treats the entry as a miss if any table was invalidated after it was
   stored.

The elegance is in step 4: invalidation is a single tiny write, regardless of
how many cached entries it affects. No purge, no fan-out, no rate limit. That
is precisely the property we want given Cloudflare's five-purges-per-minute
floor.

**Step 5 is the part that does not port.** Cachalot validates freshness *at
read time*, which requires running code on every read. A CDN hit does not run
your code — that is the entire point of it, and Cloudflare bills accordingly
("CPU time is only billed when your Worker runs"). There is no hook in which
to compare timestamps.

So the version has to move from the *validation* into the **cache key**. Same
guarantee, achieved by making stale entries unreachable rather than
detectably-stale.

#### Getting the version into the key

The key is `entrypoint + path + query + Worker version + ctx.props`, computed
from the incoming request. Something must put the version there *before* the
lookup:

| approach | how | cost |
|:--|:--|:--|
| **Two entrypoints** | An outer, uncached entrypoint reads the version map and re-dispatches to an inner, cached entrypoint via `ctx.exports`, overriding `cf.cacheKey` | The Worker runs on every request. You still skip the handler and all data access — just not the invocation. |
| **Client carries it** | `createClient` fetches a small version manifest on a short TTL and appends the stamps to request URLs | Edge hits cost zero CPU. Staleness bound becomes the manifest TTL, and only browser clients benefit. |
| **Neither** | Use tagged mode | — |

This is the real price of strict freshness on a CDN, and it was under-stated
in an earlier draft: **you buy it with a Worker invocation per request**, or
by pushing the version into the client. It is not free, and which of the two
is right depends on whether the caller is your own typed client.

#### Granularity is the lever

Cachalot is per-*table*, not per-row, and that is not a limitation — it is
what makes the model work. The version map has to be fetched **wholesale** on
the read path, so it must stay small. Twenty tables is twenty timestamps.
Per-row versions are unbounded and cannot be fetched wholesale at all.

That gives the two mechanisms opposite sweet spots, which is why this design
keeps both rather than picking one:

- **Versions are coarse and cheap.** Type-granular, tiny map, one read,
  aggressively memoizable, no rate limit, never stale. Over-invalidates: one
  post write busts every cached response derived from posts.
- **Tags are fine and expensive.** Entity-granular, exact, but purge-based —
  rate-limited and eventually consistent.

Read-heavy, low-write routes (catalogues, published content, reference data)
want versions. Write-heavy routes want tags. That is a per-route decision with
real guidance behind it, not a preference.

#### The chicken-and-egg, and the one declaration that fixes it

Cachalot reads the table set off the SQL *before* executing it. We cannot: the
tracked store only learns which entity types a route touched by running the
handler, and the version lookup has to happen before that.

The fix is the one small declaration this design keeps:

```typescript
cache: { entities: ['post', 'author'], scope: 'public', maxAge: 300 }
```

Entity *types*, not instance tags — a handful of stable names per route rather
than a template per ancestor. And it is verified rather than trusted: the
tracked store knows every type the handler actually read, so a read outside
the declared set is a loud error in development and a **refusal to cache** in
production.

That is worth noting explicitly, because it recovers something the move to
observed tags gave up. The missing-tag failure — a response that depends on
something it never recorded — becomes detectable again, and it fails closed:
an undeclared read yields an uncached response, never a wrong one.

#### The version store

A single Durable Object holding the whole map, `{ post: 1723400000123,
author: 1723399000000 }`. Reads return it entire, so a route needing three
types still costs one round trip. Writes are a single field set, driven by the
same tracked store that records mutations. Under write pressure the DO becomes
a serialization point and shards by type, at the cost of one read per shard —
which is the argument for keeping the declared entity set per route narrow.

Two rules are non-negotiable. **Bump after commit**, or a reader can observe
the new version alongside the old data and cache it under a key that will
never be invalidated again. And **fail closed**: if the version store is
unreachable, serve uncached rather than guessing a version — a guessed version
is exactly a stale cache with a fresh-looking key.

### The freshness tiers

**Tier 0 — uncached (default).** `no-store`. Never stale because never
cached. Costs nothing, guarantees everything.

**Tier 1 — `freshness: 'tagged'` (default).** Tag on read, purge on write.
Fast, cheap,
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

**Tier 2 — `freshness: 'versioned'`.** The cachalot model, described in full
above. Type versions ride in the cache key, a write bumps the version, and the
old key becomes unreachable the instant the bump commits — no propagation
window (G1 gone), and an in-flight read writes its stale response under the
*old* key where nobody will look for it again (G2 gone). Old entries age out
by TTL as garbage. Invalidation is one small write no matter how many entries
it affects, so the purge rate limit never applies.

The version map lives in a **Durable Object** — the only strongly consistent
primitive on the platform. KV cannot serve this role; up to sixty seconds of
eventual consistency is precisely the staleness being eliminated.

**The honest cost:** a strongly consistent read on the request path, in front
of the cache where the cache tier cannot absorb it, plus a Worker invocation
on every request unless the client carries the version. An isolate-memory memo
trades the guarantee back for throughput, and the memo window *is* the
staleness bound — `memoMs: 0` is a true zero at one DO round trip per request,
`memoMs: 1000` is a one-second bound for nearly nothing. That number should be
exposed rather than buried, because it is the actual guarantee.

### Tier summary

| | Tier 0 | Tier 1 `tagged` | Tier 2 `versioned` |
|:--|:--|:--|:--|
| Staleness bound | none (uncached) | purge propagation + N ms | `memoMs` (0 = never stale) |
| G1 propagation lag | n/a | bounded, undocumented by CF | eliminated |
| G2 stale set | n/a | bounded by delayed second purge | eliminated |
| **Worker runs on a cache hit** | n/a | **no — zero CPU** | **yes**, unless the client carries the version |
| Granularity | n/a | entity — precise | type — over-invalidates |
| Declaration | none | none | `entities: [...]`, verified at runtime |
| Request-path cost | none | none | one version read (memoizable) |
| Write-path cost | none | 1–2 purge calls | one DO field write |
| Rate-limit exposure | none | **yes — the real constraint** | none |
| Best for | anything per-user | write-heavy, precise invalidation | read-heavy, low-write |

The default stays `tagged`: it preserves zero-CPU cache hits, needs no
declaration, and its staleness bound is small and measurable. `versioned` is
for the routes where a bounded window is genuinely unacceptable — pricing,
entitlements, inventory — and it is worth the invocation there precisely
because those routes are usually read-heavy and rarely written.

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

**The contracts hash does have a job here, just a different one.** The `cache`
block that stays on the contract — `scope`, `maxAge`, `freshness` — must be
added to `contractFields`. Those values are emitted into the compiled module
as `Cache-Control` headers, so an edited `scope` against a stale build is
exactly the bug documented in that file's own comments about guards: the old
value shipped with nothing to catch it. Doubly so here, since a `scope` edit
from `public` to `private` is a leak fix, and shipping the stale `public` is
shipping the leak. It is a build-staleness detector, not a cache epoch.

**`createETag` composes underneath.** The edge cache handles the origin hop;
ETag plus `If-None-Match` handles the last hop to the browser and turns a
revalidation into a bodyless 304. They are complementary, not alternatives.

### Keep it portable

`@amritk/api` is framework- and platform-agnostic by design, and the caching
layer must not quietly make Cloudflare mandatory. The one contract field
(`cache`, carrying `scope` / `maxAge` / `freshness`) is pure data and stays in
the browser-safe graph; everything else lives in `@amritk/cache`, behind a
small driver seam:

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
4. **How generic can `track()` be?** Transparently wrapping an arbitrary data
   layer is the hard engineering in this design. A `Proxy` over a query
   builder catches method calls but not what they *mean*; knowing that
   `db.posts.find(123)` is a read of `post:123` needs per-store knowledge.
   The likely answer is one adapter per store (Drizzle, Kysely, raw SQL),
   which is the shape `@amritk/adapters` already uses — but the adapter
   interface should be designed before the first one is written.
5. **Is the CDC tier in scope for v1?** It is what makes "never bust a cache"
   unconditional, and it is also a separate deployment artifact (a
   replication consumer) rather than a library feature. Shipping tier 1 alone
   is defensible provided the docs are explicit that out-of-band writes are
   uncovered — silently implying otherwise would be the worst outcome.
6. **Enforcing the tracked handle.** The type-level rule that a cacheable
   route's context exposes only the tracked store is the strongest guarantee
   in this document. Working out how it composes with `createApi({ context })`
   — which today hands every route the same context type — needs design.

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
- [ReadySet](https://github.com/readysettech/readyset) — wire-compatible
  Postgres/MySQL cache with automatic invalidation from the replication stream
- [Behind the magic: streaming dataflow in ReadySet](https://readyset.io/blog/behind-the-magic-how-readyset-speeds-up-queries-with-streaming-dataflow)
- Noria: dynamic, partially-stateful dataflow for high-performance web
  applications (MIT, OSDI 2018) — the research ReadySet commercializes
