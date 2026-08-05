---
'@amritk/api': minor
---

Support magic-link auth from native apps, where the client has no cookie jar.

Two new exports, both for failures that present to a developer as "bad token":

- **`exemptBearer`** — a `createCsrf({ exempt })` predicate. A native client can
  neither receive the seeded `csrf_token` cookie nor echo it back, so every
  unsafe-method call from one took a `403`. Keying the exemption on the
  `authorization` header is what makes it safe: a page on another origin cannot
  attach one without a preflight the server never grants. Shipping it as an
  export exists to head off the intuitive alternative — exempting requests with
  no `Origin` — which looks equivalent and is a bypass, since same-site form
  posts routinely omit `Origin`.
- **`createBearerSession`** (also on `@amritk/api/client`) — the
  stored-session-token model, filling the gap between the two existing helpers.
  It wraps `fetch` rather than providing `headers`, because both halves of the
  bearer model need to see responses: it attaches the stored token, captures a
  rotated one off `set-auth-token` (Better Auth extends a session on `updateAge`,
  so rotation *is* the refresh and costs no extra round-trip), and on a `401`
  either runs an optional single-flighted `refresh` and replays **under the new
  token**, or clears storage and fires `onExpired`. `storage` is required and
  undefaulted so an in-memory fallback cannot look correct until the app
  relaunches and signs everyone out.

That replay is the trap the helper exists to close: `createRefreshFetch` can
replay an untouched `RequestInit` because the browser re-attaches the freshly
`Set-Cookie`'d session itself, and nothing does that for a bearer token — reusing
the original init would present the dead token and `401` again.

Also documents the flow end to end. The Better Auth guidance was browser-shaped
throughout — it forwarded only `cookie` into `getSession`, so a `bearer()`
session silently resolved to `null` and every guard denied with its declared 401.
The new "Native apps" section covers the deep-link `callbackURL` and
`trustedOrigins` (and why a custom scheme belongs there rather than in
`createCors`, which has no `Origin` to negotiate with a native caller), the `302`
+ `Set-Cookie` passing through the mount untouched, forwarding both `cookie` and
`authorization` into `getSession`, and says outright that the CSRF exemption
covers bearer callers only rather than leaving the Expo cookie shape to fail
quietly.
