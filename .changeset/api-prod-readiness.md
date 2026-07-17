---
'@amritk/api': minor
---

Production-readiness pass over both engines and both adapters:

- **HEAD support (RFC 9110)**: `HEAD` is served automatically wherever `GET` is — the GET pipeline runs (validation, handler, response headers) and the adapters discard the body, cancelling streams rather than leaking them. Explicit `head` routes override the fallback. `405` allow lists advertise `HEAD` whenever `GET` appears, `matches()` claims HEAD for Express-style fallthrough, and the OpenAPI path answers HEAD too. Implemented identically in the runtime and compiled engines (held by the differential corpus).
- **Shared buffered body reads**: `readBody`/`readText`/`readBytes` now share one buffered read in both adapters and in compiled modules, so handlers can read the body repeatedly and alongside a declared body schema (webhook HMAC plus parsed access). Previously a second read hung forever on Node and threw on fetch runtimes.
- **Adapter failure boundary**: a reply that cannot be serialized (circular body, invalid header name/value) now answers the pipeline's own `500 { error: 'internal_error' }` instead of escaping as an unhandled rejection — in `toFetchHandler`, `toNodeHandler` (which pre-validates handler headers, since a mid-write `writeHead` failure leaves Node's response unrecoverable), and compiled modules.
- **Query hardening**: query objects are built with a null prototype, so keys like `__proto__` land as ordinary own properties for the schema to judge instead of being silently dropped by the prototype setter.
- **Node adapter**: JSON replies carry `content-length` instead of chunked transfer encoding.
- **Packaging**: `sideEffects: false` and `engines.node >= 20` declared; README documents the requirements, the pre-1.0 stability policy, and the fetch/Node adapter feature split.
