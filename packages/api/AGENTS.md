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
- **Four entries, each one-way:** `.` (runtime/client/adapters/OpenAPI),
  `./client` (the browser-safe subset of `.`), `./bundler` (the build-time
  contract strip), and `./dev` (hot reloading). The dependency only ever points
  *into* `.`: bundler and dev code may import the runtime, never the reverse.
  That is what keeps `node:fs` watching and module re-importing out of the
  graph that ships to Workers and browsers — do not add another entry without
  the same justification.
- **`./bundler` ships the transform, not plugins.** `stripContractFields` and
  `isScannableId`, wired into the consumer's own bundler hook (the README has
  a snippet per bundler). The per-bundler plugin objects were removed because
  a plugin matrix is permanently one entry behind the ecosystem — an rspack
  request against a vite/rollup/esbuild/bun lineup is what proved it. Adding
  `stripContractsX` back re-opens that. Keep this entry free of `node:*` imports too, so a config file in any
  runtime can load it.
- **`./client` must stay browser-safe.** `src/client.ts` re-exports only
  modules whose transitive imports touch no server code and no `node:*`
  built-in; `client.test.ts` walks the import graph and pins the exact
  reachable file set. Adding an export there means updating that list — if the
  test's diff shows a server module, the export does not belong in `./client`.
  The same goes for the client opt-ins (`queryParams`, `cookies`, `pathParams`,
  `serializers`): they are opt-in precisely so `create-client.ts` never
  imports them statically. Do not "simplify" by importing one directly.
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
- `format` is an annotation unless the caller passes `formats` (`'all'` or a
  list) to **both** `createApi` and `compileToModule` — the engines have to be
  configured alike. With it on, format-bearing schemas leave the inlinable subset
  and fall back to the interpreter rather than growing a second copy of every
  format regex in `generate-guard-source.ts`.

Add a changeset for every change (`bunx changeset`).
