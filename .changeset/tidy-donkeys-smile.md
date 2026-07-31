---
'@amritk/api': minor
---

Security and correctness fixes across the compiled engine, the fetch adapter, and the hook helpers.

- **`compileToModule` no longer interpolates contract strings into generated source unchecked.** Response status keys, `bodyType`, `method`, and `maxBodyBytes` are validated at emit time and emitted from narrowed values, so a programmatically-built contract (from a config file, a database row, an imported OpenAPI document) can no longer inject code into the module that ships. `defineRoute`/`defineContract` are identity functions with no runtime validation, which is what made this reachable.
- **Guards added or removed after a compile are no longer silently unenforced.** `hashContracts` now fingerprints the *presence* of `guards`, `securityGuards`, and `refine` (their bodies are still excluded, so rewriting one is not staleness), and the emitted module additionally **throws** at init when that shape drifted — a deploy that fails loudly beats one that quietly stops checking credentials. Ordinary schema drift keeps warning and keeps serving.
- **The compiled engine honours the `raw` escape hatch on the error paths.** An `onError` or `errors.*` formatter returning `raw(response)` used to lose its body in the compiled module while the runtime engine sent it.
- **`createETag` enforces `maxBytes` while reading** instead of buffering the whole body first. A large streamed reply was fully buffered just to discover it was over the limit; the cap now bails mid-read and passes the response through without losing already-read chunks.
- **A throwing `onRequest`/`onResponse` hook becomes the pipeline's 500** in both engines instead of escaping to the platform (a Workers 1101, a Bun unhandled rejection).
- **New `writableResponse` export**, used by `createCors`, `createCsrf`, `createRateLimit`, and `createRequestId`. A `Response` from a proxying mount has immutable headers, so mutating them directly threw — and per the previous point, that throw cost the whole reply.
- **`createDocs` escapes `cdn` and `integrity`**, pins the Scalar bundle version (new `SCALAR_VERSION` export and `version` option) instead of floating on `@latest`, and accepts an `integrity` option for subresource integrity.
- **`signCookie`'s imported-key cache is bounded**, so a per-tenant secret-rotation loop no longer retains a `CryptoKey` per distinct secret forever.
- **The package root no longer pulls `node:*` into a Workers or browser bundle.** `node:http`, `node:stream`, and `node:events` reached the root entry through the Node adapters and broke `esbuild --platform=browser` outright (resolution runs before tree-shaking). The adapters now load their built-ins on demand and `waitForDrain` dropped `node:events` entirely; a graph-walking test over `index.ts` pins the invariant.
