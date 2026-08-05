# Auth and sessions: agent-ummo on `@amritk/api`

Companion to `ummo-readiness.md`. That doc audits what the *framework* had to
grow; this one is about how agent-ummo should hold a **session** once it is on
the framework — and what a **native app** changes, since a magic-link sign-in
from one fails in several places that all present to a developer as "bad token".

> **Status (2026-08): findings, not landed work.** The framework side shipped —
> `exemptBearer` and `createBearerSession` are exported, and the README carries a
> "Sessions: a production setup" section. Everything under
> [What agent-ummo must change](#what-agent-ummo-must-change) is unlanded, and the
> Hyperdrive item is the one worth reading first: it is a live revocation hole in
> the deployed configuration, not a future concern.

## The model, and why

Keep the **server-held opaque session token** Better Auth issues by default.
The token is a handle to a row Better Auth owns, and the reason to want that is
revocation: sign-out kills every copy of the credential on the next request. A
self-contained token cannot be recalled once issued, so a stolen one stays valid
for its full lifetime no matter what you do.

This inverts the usual instinct, so it is worth stating plainly:

| | Opaque session token | JWT |
|:--|:--|:--|
| Revoke on sign-out | immediate | impossible before expiry |
| Cost per request | one lookup | signature verify |
| Verifiable without your server | no | yes |

Reach for Better Auth's JWT plugin only when a *second* service or an edge worker
must verify identity without calling you — it verifies against `/jwks`, and its
15-minute default expiry is the mitigation for the un-revocability. That is a
service-to-service credential minted **from** the session, not a replacement for
it. Better Auth's own docs point you at the bearer plugin for authenticating
clients.

## Findings

### 1. Hyperdrive is caching the session lookup — revocation is delayed

Both Hyperdrive configs have query caching enabled with the defaults:

| Config | Origin | Caching |
|:--|:--|:--|
| `agent-ummo-production` | Neon, `us-east-1` | enabled (`disabled: false`) |
| `agent-ummo-staging` | Neon, `us-east-1` | enabled (`disabled: false`) |

Hyperdrive's defaults are `max_age` 60s and `stale_while_revalidate` 15s, and it
**does not invalidate cached reads when you write**. So a session lookup routed
through either binding can keep authorizing a signed-out user for over a minute
after the session row is gone — which spends exactly the revocation property the
model above was chosen for. Cloudflare's own guidance names authentication,
sessions, and permissions as reads that need a cache-disabled configuration.

**Verify before changing anything.** Hyperdrive reports metrics by `cacheStatus`
(`hit` / `miss` / `disabled` / `uncacheable`). Prepared statements, transactions,
and any `STABLE` function reference such as `NOW()` make a query uncacheable, so
Better Auth's session query may already be exempt by accident. If it reports
`uncacheable`, there is no hole and no work to do here.

### 2. The session lookup makes Smart Placement worth turning on

Cloudflare is explicit that placement does nothing for a request making a
*single* query — the round trip costs the same wherever it happens. A session
lookup plus the handler's own query is **two sequential** round trips, which is
the case placement compounds: 20–30 ms per query from a distant region against
1–3 ms when the Worker runs near the database. Both origins are `us-east-1`.

Hyperdrive already removes the seven round trips of connection setup (TCP 1×,
TLS 3×, auth 3×); placement addresses the query legs that remain.

### 3. Everything else in the request is noise

Worth knowing before tuning the wrong layer. The gates and decorators — CORS,
CSRF, security headers, rate limiting — are **single-digit microseconds**
combined. The session lookup is **1–50 ms**. Optimize the lookup (lazy, memoized
per request, store near the compute); leave the middleware alone.

One exception, and it is a real one: never call `new URL()` in a gate to test a
path. The adapter's own benchmark puts a URL parse at roughly a fifth of
per-request cost. Slice the pathname out of `request.url` instead.

## What agent-ummo must change

Grouped by where the change lands. None of this is verified against the
agent-ummo tree — check current state before assuming any step is outstanding.

### Infrastructure (Cloudflare)

1. Create a second Hyperdrive config per environment with caching disabled, and
   give **Better Auth** a client built on that binding. Connection pooling and
   edge connection setup still apply, so the latency win survives; only the
   staleness goes. Do not lower `max_age` on the existing config instead — that
   is config-wide, so it degrades caching for every read while still leaving a
   stale window on the one that matters.
2. Set `placement.region` to match the Neon region (`aws:us-east-1`).

### Server

3. `createCsrf({ exempt: exemptBearer })`. Without it every native `POST` takes a
   403 — a cookie-less client can neither receive the seeded `csrf_token` nor
   echo it. `exemptBearer` requires a bearer token **and no cookie**; the cookie
   half is load-bearing, since a bearer header alone is attacker-settable and a
   cross-site page could otherwise bolt one on to disarm the check while the
   victim's cookie kept authenticating the request.
4. Forward **both** `cookie` and `authorization` into `auth.api.getSession`. A
   cookie-only factory resolves a `bearer()` session to `null`, and every guard
   then denies with its declared 401 — which reads as a bad token rather than a
   dropped header.
5. Keep that lookup lazy and memoize it per request, so public routes pay nothing
   and a guard plus a handler share one query.
6. Rate-limit `/api/auth/*` specifically. Gates run before mounts, so the mounted
   Better Auth router is inside the limit rather than beside it. Unthrottled,
   a passwordless endpoint is an email-bombing relay, a bill someone else runs
   up, and an account-enumeration oracle. The default rate-limit key is a
   **spoofable** IP header — use a proxy-verified one, and consider a second
   limiter keyed on the submitted email.
7. Declare cookie and bearer as **two separate** `security` entries. One entry
   listing both means "send both"; two mean "either works", which is the truth.

### Native client

8. Add the deep-link scheme to Better Auth's `trustedOrigins` and point the
   magic link's `callbackURL` at it. The email link opens the *system browser*,
   so that hop is a real browser request; the `302` and its `Set-Cookie` pass
   through the mount untouched.
9. Enable the `bearer()` plugin for the app's API surface. Prefer it over Expo's
   manual-cookie shape, which is aimed at Better Auth's own endpoints and would
   still take the CSRF 403.
10. Use `createBearerSession({ storage, onExpired })` on the client, with
    `expo-secure-store` or the platform keychain — **not** `AsyncStorage` or
    `localStorage`, which hand a live session to any script or process that gets
    in. Scope that fetch to agent-ummo's API only: it captures `set-auth-token`
    from whatever replies, so a shared fetch lets any host overwrite the session.
11. Leave `refresh` unset. There is no refresh token and no renewal endpoint in
    this model — the server rolls the session's expiry forward when a request
    arrives past `updateAge`, keeping the same token, so sending it is the
    renewal. A gap longer than `expiresIn` ends in a 401 that clears storage and
    routes to sign-in, which is the only way back for a magic-link session.

## Prompt for the agent-ummo side

Self-contained; assumes no context from the conversation that produced this doc.

```text
Context: our Workers apps use Better Auth (magic link) mounted at /api/auth/*
against Neon Postgres via Hyperdrive, and we are adding a native app. Work
through the following. Verify current state before each change — several may
already be done. Do not assume this list is accurate about the tree.

1. FIRST, verify a suspected revocation hole. Our Hyperdrive configs
   (agent-ummo-production, agent-ummo-staging) both have query caching enabled
   with the defaults: max_age 60s, stale_while_revalidate 15s, and Hyperdrive
   does not invalidate cached reads on write. If Better Auth's session SELECT is
   being cached, a signed-out user stays authorized for up to ~75s. Check
   Hyperdrive metrics by cacheStatus (hit / miss / disabled / uncacheable) for
   the session query. If it reports uncacheable — prepared statements,
   transactions, or any STABLE function like NOW() cause this — there is no hole;
   report that and skip step 2.

2. If it IS being cached: create a second Hyperdrive config per environment with
   --caching-disabled against the same Neon origin, bind it alongside the
   existing one (e.g. HYPERDRIVE_AUTH), and construct a separate database client
   from it that ONLY Better Auth uses. Pooling and edge connection setup still
   apply, so latency is unaffected. Do not instead lower max_age on the existing
   config: that is config-wide, degrading caching for every read while still
   leaving a stale window on sessions.

3. Set placement.region to match the Neon region (aws:us-east-1) in the Workers
   config. Rationale: placement does nothing for a single-query request, but a
   session lookup plus the handler's own query is two sequential round trips —
   20-30ms each from a distant region vs 1-3ms placed.

4. Server, session lookup: forward BOTH `cookie` and `authorization` headers into
   auth.api.getSession. A cookie-only context factory resolves a bearer session
   to null and every guard then denies with a 401 that looks like a bad token.
   Keep the lookup lazy (public routes pay nothing) and memoized per request (a
   guard and a handler share one query).

5. Server, CSRF: pass `exemptBearer` (exported from @amritk/api) as createCsrf's
   `exempt`. Cookie-less clients cannot echo the double-submit token and would
   403 on every write. Do NOT hand-roll this exemption: keying it on the
   authorization header alone is a bypass, because that header is attacker-
   settable — exemptBearer also requires the absence of cookies. Keying it on a
   missing Origin is likewise a bypass, since same-site form posts omit Origin.

6. Server, rate limiting: add a limiter scoped to /api/auth/*. Gates run before
   mounts, so the Better Auth router is inside it. Passwordless endpoints are
   otherwise an email-bombing relay and an account-enumeration oracle. The
   default key is a spoofable IP header — use a proxy-verified IP, and add a
   second limiter keyed on the submitted email. When testing the path prefix in
   the gate, slice the pathname out of request.url; do NOT call new URL(), which
   benchmarks at ~1/5 of per-request cost and runs on every request.

7. Server, OpenAPI: declare cookie auth and bearer auth as two SEPARATE entries
   in the document-level `security` array. One entry listing both schemes means
   "send both"; two entries mean "either works", which is what we serve.

8. Native app, server config: add the app's deep-link scheme (e.g. "myapp://")
   to Better Auth's trustedOrigins and point the magic link's callbackURL at it.
   Note the email link opens the system browser, so that hop is a real browser
   request — the 302 and its Set-Cookie pass through the mount untouched.

9. Native app, plugin: enable Better Auth's bearer() plugin for the app's API
   surface. Prefer it over Expo's manual-cookie approach, which targets Better
   Auth's own endpoints and would still hit the CSRF 403 from step 5.

10. Native app, client: use createBearerSession({ storage, onExpired }) from
    @amritk/api/client, wired to expo-secure-store or the platform keychain —
    NOT AsyncStorage or localStorage, which expose a live session to any script
    or process that gets in. Pass session.fetch to createClient. Scope that fetch
    to our API only: it captures set-auth-token from any reply, so sharing it
    across hosts lets any of them overwrite the stored session. Leave `refresh`
    unset — there is no refresh token in this model; the server rolls the
    session's expiry forward when a request arrives past updateAge, so sending
    the token is the renewal. Route to sign-in from onExpired.

Report anything already done, anything that turns out not to apply, and any
place where our actual setup contradicts the assumptions above.
```

## What is not verified

Stated plainly so nobody inherits an inference as a fact:

- **Whether Better Auth's session query is actually cached** by Hyperdrive. The
  defaults and the config flags are confirmed; the query's cacheability is not.
  Step 1 of the prompt settles it.
- **Better Auth's resolution order** when a request carries both a cookie and a
  bearer token. The dual-header forwarding is correct either way, but the
  precedence has not been exercised against a live instance.
- **The 1–50 ms session-lookup range** is reasoned from topology, not measured on
  agent-ummo. The middleware figures and the `new URL()` ratio come from the
  package's own benchmarks.
