---
'@amritk/api': minor
---

Add `createTokenRefresh`, a client-side auth-refresh helper that plugs into
`createClient({ headers })`. It renews a bearer token on the token's own clock
with two paths over a single primitive: concurrent calls on an expired token
queue behind one shared refresh (single-flight), and a token nearing expiry is
renewed in the background — under traffic, or on an idle timer — so auth stays
seamless. JWTs are zero-config (the `exp` claim is decoded automatically); an
`expiry` override or an explicit `{ token, expiresAt }` from `refresh` covers
opaque and OAuth-style credentials. Also exports the underlying `decodeJwtExpiry`
helper. Nothing changes for existing `createClient` users.
