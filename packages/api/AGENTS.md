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
- **Three entries, each one-way:** `.` (runtime/client/adapters/OpenAPI),
  `./bundler` (build-time strip plugins), and `./dev` (hot reloading). The
  dependency only ever points *into* `.`: bundler and dev code may import the
  runtime, never the reverse. That is what keeps `node:fs` watching and module
  re-importing out of the graph that ships to Workers and browsers — do not add
  a fourth entry without the same justification.
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
