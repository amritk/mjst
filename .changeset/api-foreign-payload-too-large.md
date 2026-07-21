---
"@amritk/api": patch
---

Map the host framework's body-limit error to a 413. When the API is mounted on
another server (Fastify's content-type parser at its `bodyLimit`, Express's
`body-parser`/`raw-body`, or any HTTP error carrying a 413 status), an
oversized body now takes the `payloadTooLarge` path instead of the generic
`onError`/500 — fixing e.g. a 20 MiB body returning `500` rather than `413`.
Recognition is shared by the interpreted and compiled engines.
