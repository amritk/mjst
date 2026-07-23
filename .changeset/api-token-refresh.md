---
'@amritk/api': minor
---

Add client-side auth-refresh helpers for `createClient`, covering both the
bearer-token and HttpOnly-cookie models. Nothing changes for existing
`createClient` users.

**Bearer tokens** — `createTokenRefresh` plugs into `createClient({ headers })`
and renews a token on its own clock over one single-flight primitive: concurrent
calls on an expired token queue behind one shared refresh, and a token nearing
expiry is renewed in the background (under traffic or on an idle timer) so auth
stays seamless. JWTs are zero-config (the `exp` claim is decoded automatically,
via the exported `decodeJwtExpiry`); an `expiry` override or an explicit
`{ token, expiresAt }` from `refresh` covers opaque and OAuth-style credentials.

**HttpOnly cookies** — `createRefreshFetch` wraps `createClient({ fetch })` so an
expired session refreshes and the request replays once, single-flighted, keyed on
a real `401` (also catching early server-side revocation). `createCsrfHeader`
echoes the non-`HttpOnly` `csrf_token` cookie in the `x-csrf-token` header, the
client half of the double-submit pair `createCsrf` checks on the server. Together
with `fetchOptions: { credentials: 'include' }` the browser holds no token at
all.
