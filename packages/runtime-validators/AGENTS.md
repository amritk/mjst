# AGENTS.md — @amritk/runtime-validators

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Eval-free runtime JSON Schema validation — interprets a schema not known ahead
of time.

## Commands

```bash
bun run --filter='@amritk/runtime-validators' build   # required before others' tests consume it
bun run --filter='@amritk/runtime-validators' test
```

## Invariants — do not break these

- **Eval-free is the entire point:** never introduce `new Function` / `eval`. It
  must run under a strict CSP. (For codegen'd straight-line validators, that's
  `@amritk/generate-validators` — a different package.)
- **`validate` success is the literal `true`**; `{ valid: false; errors }` on
  failure. `validateGuard` returns a boolean type guard; `assert(schema, value)`
  returns the typed value or throws. Keep these three shapes.
- **Only local `$ref`s resolve** (`#/$defs/x`, `#anchor`, recursion). Remote/
  cross-file is out of scope — bundle with `@amritk/resolve-refs` first.
- `format` enforcement is opt-in (annotations by default), matching Ajv.
- Consumed from **`dist`** (not `src`) in the monorepo's vitest aliases because
  of internal `@/` path rewrites — a build must run first (root `pretest`
  handles it). Don't assume src-aliasing.

Add a changeset for every change (`bunx changeset`).
