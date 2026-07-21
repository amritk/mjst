---
"@amritk/api": minor
---

Add framework-parity middleware helpers, each composing through the existing
`onRequest`/`onResponse`/`mounts` seams (no core pipeline changes):

- `createRateLimit` — request rate limiting with `RateLimit-*`/`Retry-After`
  headers, a 429 short-circuit, and a pluggable store (in-memory default).
- `createRequestId` — correlation-id propagation into `locals` and the
  response, with `getRequestId`.
- `createSecurityHeaders` — the `helmet`/`secure-headers` baseline as an
  `onResponse` decorator.
- `createCompression` — gzip/deflate response compression over the platform
  `CompressionStream`.
- `createETag` — automatic entity tags and conditional-GET (`304`) handling.
- `createDocs` — an interactive API reference page (Scalar/Swagger UI/ReDoc)
  served next to `openapi.json`, with `docsHtml`.
