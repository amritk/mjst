# AGENTS.md — @amritk/helpers

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Shared schema-traversal, codegen, and runtime utilities for the mjst ecosystem.

## Commands

```bash
bun run --filter='@amritk/helpers' test
bun run --filter='@amritk/helpers' types:check
```

## Invariants — do not break these

- **No barrel — wildcard `./*` subpath exports** map each `src/<name>.ts` to
  `@amritk/helpers/<name>`. There is no `.` root entry; keep imports per-file.
- **Some modules are copied verbatim into generated output** (`is-object`,
  `safe-accessor`, `validate-array`, `validate-record`). These must stay
  **dependency-free** and self-contained — a new import here can break generated
  code that inlines them.
- Two easily-confused guards live here: `isSchemaObject` (non-boolean schema) vs
  `isObjectSchema` (`type: object`). Keep both, keep the names distinct.
- This package **ships its `src/`** (see `files`) so consumers can read/inline —
  keep comments accurate.

Add a changeset for every change (`bunx changeset`).
