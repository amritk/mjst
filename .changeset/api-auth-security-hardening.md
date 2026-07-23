---
"@amritk/api": patch
---

Security hardening for the auth helpers, plus reference docs for the built-in
security hooks.

- **`createTokenRefresh`** — `invalidate()` (and `dispose()`) now win a race
  against an in-flight background refresh. Previously, a refresh already on the
  wire when the caller invalidated would repopulate the token on resolve,
  silently undoing a logout or a post-401 drop. A generation guard makes the
  in-flight refresh discard its result instead of resurrecting the token.
- **`createCsrf`** — the seeded `csrf_token` cookie now defaults to
  `Path=/; SameSite=Lax; Secure` (was missing `Secure`), so the double-submit
  token never rides a plaintext request; drop `Secure` via `cookieAttributes`
  for a plain-HTTP dev origin. The gate now rejects empty tokens explicitly, so
  a blank cookie/header pair can never satisfy the equality check.
- **`createRateLimit`** — documented that the default key derives from
  client-supplied, spoofable IP headers and must not be relied on for a
  security throttle without a trusted proxy; use a proxy-verified IP or an
  authenticated `locals` user id for login/brute-force limits.
- **Docs** — README now has a "Built-in security hooks", "Signed cookies", and
  "Client-side auth refresh" reference covering `createSecurityHeaders`,
  `createCors`, `createRateLimit`, `createCsrf`/`createCsrfHeader`,
  `signCookie`/`createSignedCookies`, `createTokenRefresh`, and
  `createRefreshFetch`; AI.md gains a compact security-helper summary.
