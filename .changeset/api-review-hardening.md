---
"@amritk/api": minor
---

Deep-review hardening pass across the client, OpenAPI projection, request pipeline, and bundler plugins.

**Breaking (pre-1.0 minor): request bodies are now capped at 1 MiB by default.** `maxBodyBytes` keeps its meaning on both adapters and `compileToModule`; unset now means 1 MiB instead of unbounded (a memory-exhaustion vector), and `maxBodyBytes: Infinity` restores unbounded reads.

**Typed client.** `fetchOptions` (client-level and per-call `RequestInit` extras — `credentials`, `cache`, `redirect`, …) and `timeoutMs` (composes with a per-call `signal` via `AbortSignal.any`). Requests send `accept: application/json` by default. A declared JSON status whose body fails to parse throws `malformedBodyError` — recognizable via `isMalformedBodyError`, carrying the `Response` and the parse error as `cause` — instead of a bare `SyntaxError`. Documented: the `cookies` slot cannot work from browsers (forbidden header); use server-set cookies plus `fetchOptions: { credentials: 'include' }`.

**OpenAPI.** Greedy `{name+}` routes now emit valid documents (`{name}` templates with a matching, described parameter). Schemas carrying internal `$ref`s hoist into `components.schemas` with refs re-rooted, so recursive shapes resolve. Every operation gets a deterministic `operationId` (explicit wins; duplicates throw at startup). `info` accepts `contact`/`license`/`termsOfService`, documents accept top-level `tags` objects (plumbed through `createApi` and `compileToModule`), and multipart file parts get `encoding` entries. The served document carries a strong `etag` + `cache-control: no-cache`, answers `304` to `if-none-match`, and is serialized once per process.

**HTTP semantics (both engines, differential-pinned).** `OPTIONS` on a known path answers `204` with a sorted `allow` header (explicit `options` routes still win), and 405 `allow` lists advertise `OPTIONS`. `refine` may be async — a returned promise is awaited, rejections take the `onError` path.

**Node adapter.** Streaming replies honor `write()` backpressure with a hang-proof `drain` wait, so fast producers no longer buffer unbounded memory against slow clients.

**CORS.** `createCors` throws at setup on the browser-rejected `origin: '*'` + `credentials: true` combination.

**Bundler.** New `stripContractsEsbuild` and `stripContractsRollup` join the Vite and Bun plugins, and the strip transform is now line-preserving so `map: null` no longer misaligns downstream sourcemaps.

The cap keeps the native read path: a body whose declared `content-length` fits the limit reads via `arrayBuffer()` (with a post-read length check), and only chunked or unparseable-length requests take the streaming capped reader — so on realistic traffic the default cap costs ~4%, not the 82% an always-streaming read would.
