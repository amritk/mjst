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
  refused host, or bad ref becomes `{}` and is reported while the rest resolves.
  Preserve this — callers depend on partial resolution.
- **Default-deny SSRF guard** (`isPrivateHost`): loopback / private / link-local
  / cloud-metadata hosts are refused unless explicitly allowed. Security-
  sensitive — change only with tests, and keep the default denying.
- **`resolveRefs` is in-memory / internal-refs only**; cross-file + remote is
  `resolveRefsFromFile`. Don't make the sync function do I/O.
- **JSON-only by default** (`JSON.parse`); YAML support is opt-in via a `parse`
  hook. Cycles are preserved as `$ref` (output is not always fully flat).

Add a changeset for every change (`bunx changeset`).
