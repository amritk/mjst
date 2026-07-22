# AGENTS.md — @amritk/api

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package instead? See
[`AI.md`](./AI.md).

Contract-first HTTP API layer: JSON Schema routes → typed handlers, runtime
validation, OpenAPI 3.1, and a derived typed client.

## Commands

```bash
bun run --filter='@amritk/api' test
bun run --filter='@amritk/api' types:check
```

## Invariants — do not break these

- **ESM-only.** No CJS entry point. Keep it that way.
- **Two entries only:** `.` (runtime/client/adapters/OpenAPI) and `./bundler`
  (build-time strip plugins). Bundler code must never be imported by runtime/
  server code.
- **The adapter split is intentional:** hooks / `mounts` / CORS belong to
  `toFetchHandler`, not `toNodeHandler`. Don't add them to the Node adapter.
- **Lots of exports are compiler plumbing** (`buildQueryObjectFromString`,
  `decodeSegment`, `coercePrimitive`, …) — they exist so `compileToModule`'s
  emitted code can import them. Treat them as internal; the public surface is the
  `define*` / `create*` / `to*` families and the types.
- Tests declare schemas **inline / `as const`** so the `const` generics capture
  literals — mirror that in new tests.
- Validation defaults to the eval-free `@amritk/runtime-validators` engine (CSP-
  safe). Keep the default path free of `new Function`.

Add a changeset for every change (`bunx changeset`).
