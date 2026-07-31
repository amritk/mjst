# AGENTS.md — @amritk/resolve-refs

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Resolves and inlines JSON Schema / OpenAPI `$ref`s (internal, cross-file,
remote) with caching and an SSRF guard.

## Commands

```bash
bun run --filter='@amritk/resolve-refs' test
bun run --filter='@amritk/resolve-refs' types:check
```

## Invariants — do not break these

- **Errors are collected on `result.errors`, never thrown.** A missing file,
  refused host, refused path, bad ref, or over-deep document becomes `{}` and is
  reported while the rest resolves. Preserve this — callers depend on partial
  resolution. Every recursive walk in this package is depth-capped for exactly
  this reason; a new one needs the same cap (`DEFAULT_MAX_DEPTH`).
- **Default-deny SSRF guard**: `isPrivateHost` (sync, URL-only) plus
  `assertPublicHost` (async, resolves the name) refuse loopback / private /
  link-local / cloud-metadata hosts unless explicitly allowed. `isPrivateHost`
  must stay synchronous and pure — the CLI and `@amritk/lint` call it directly.
  Security-sensitive: change only with tests, and keep the default denying.
- **Default-deny local reads**: a local `$ref` must resolve under
  `dirname(rootLocation)` (or an explicit `allowedRoots`). The root document
  itself is exempt — the caller named it.
- **The remote cache key covers credentials**, not just the URL. Anything added
  to `ResolveOptions` that changes *what comes back* from a fetch belongs in
  `fetchScope`, or the cache leaks one caller's document to another.
- **`resolveRefs` is in-memory / internal-refs only**; cross-file + remote is
  `resolveRefsFromFile`. Don't make the sync function do I/O.
- **JSON-only by default** (`JSON.parse`); YAML support is opt-in via a `parse`
  hook. Cycles are preserved as `$ref` (output is not always fully flat).

Add a changeset for every change (`bunx changeset`).
