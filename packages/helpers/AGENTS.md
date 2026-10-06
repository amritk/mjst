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
  `has-ref`, `validate-array`, `validate-record`, `coercion-runtime` — the
  `RuntimeHelperName`s in `@amritk/validation`'s `collect-helpers.ts`). These
  must stay **dependency-free** and self-contained — a new import here can break
  generated code that inlines them.
- Two easily-confused guards live here: `isSchemaObject` (non-boolean schema) vs
  `isObjectSchema` (`type: object`). Keep both, keep the names distinct.
- This package **ships the `src/` of `has-ref`, `is-object`, `validate-array`
  and `validate-record`** (see `files`) so embedded mode can copy them as
  TypeScript; any other embedded helper falls back to its compiled `dist/` file.
  Keep their comments accurate — they land in consumers' source trees.

Add a changeset for every change (`bunx changeset`).
