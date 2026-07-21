---
"@amritk/api": minor
---

Add more framework-parity helpers, all composing through existing seams
(`mounts`, `onRequest`/`onResponse`, the raw response, the context factory) —
no request-pipeline changes:

- `createCsrf` — stateless double-submit CSRF protection.
- `createHealth` — a health/readiness endpoint (`200`/`503`) running probes
  concurrently, for load balancers and Kubernetes gates.
- `signCookie`/`unsignCookie`/`createSignedCookies` — HMAC-SHA256 signed
  cookies over Web Crypto (no dependency).
- `sseStream`/`formatSse` — Server-Sent Events as a streaming body for
  raw-`contentType` routes.
- `negotiateMediaType`/`parseAccept` — server-driven content negotiation with
  RFC 9110 media-range specificity and `q=0` handling.
- `versionRoutes` — URI-prefix API versioning (`/v1`, `/v2`).
- `withTimeout` — a per-handler wall-clock deadline.
- `runAfterResponse`/`createBackground` — after-response ("background") work
  via `waitUntil` where the platform provides it.
