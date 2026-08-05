---
'@amritk/api': patch
---

Document the native-app path through the Better Auth mount. The existing guidance
is browser-shaped throughout — it forwards only `cookie` into `getSession` and
pairs the client with `credentials: 'include'` — which leaves an iOS/Android/Expo
magic-link sign-in failing in two places that both look like a bad token: a
`bearer()` session resolves to `null` because the `authorization` header is
dropped before `getSession` ever sees it, and every native `POST` takes a `403`
from `createCsrf`, whose double-submit cookie no native client can echo.

The new "Native apps" section walks the flow through the seams it actually
touches: `trustedOrigins` for the deep-link `callbackURL` (and why the custom
scheme belongs there rather than in `createCors`, which has no `Origin` to
negotiate with a native caller), the `302` + `Set-Cookie` passing through the
mount untouched, forwarding both `cookie` and `authorization` into `getSession`,
a `createCsrf` `exempt` keyed on the bearer header — with the reasoning for why
that is sound and why the looser "no `Origin`" test would be a bypass — and
`createTokenRefresh` in place of `credentials: 'include'` on the client.
