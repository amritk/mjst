# AGENTS.md — the parser engine

Contributor guide for AI agents editing **this directory**, the parser and type
engine inside `@amritk/validation`. Repo-wide rules:
[`../../../../AGENTS.md`](../../../../AGENTS.md). Consuming the package? See
[`AI.md`](../../AI.md).

Generates TypeScript types + runtime parsers from a JSON Schema. It is internal:
nothing outside `@amritk/validation` imports it, and `src/generate.ts` is its only
caller.

## Commands

```bash
bun run --filter='@amritk/validation' test
bun run --filter='@amritk/validation' types:check
```

## Invariants — do not break these

- **`buildSchema` returns `GeneratedFile[]` in memory** — it never writes to
  disk. Keep it pure so callers (CLI, tests) control output.
- **The signature is positional** and append-only: add new options to the
  **end** of the parameter list so existing callers keep working. A new option
  reaches users only through `GenerateOptions` in `src/generate.ts`, so map it
  there and update the package README's options table + JSDoc when you do.
- Output always includes an `index.ts` barrel and, in `'embedded'` helpers mode
  (unless `typesOnly`), the runtime helper files under `_helpers/` — golden/snapshot
  tests assume the full file set.
- Default parsers **coerce**; `strict` makes them throw. Keep both paths tested.
- **The coercing parser agrees with `coerceX`**: wherever `coerceX` accepts a
  document, `parseX` returns the same value. A definition with
  `anyOf`/`oneOf`/`allOf`/`if`/`not` gets `matchesX` + `coerceXInput` in front
  of a private `_parseXRepair` (`generate-exact-half.ts`, built from the
  validator engine's own emitters). `parse-vs-coerce.differential.test.ts` pins
  it — do not give the parser its own idea of what a branch accepts.
- Shares the `GeneratedFile` = `{ filename, content }` shape with the other
  generators; don't diverge it.

Add a changeset for every change (`bunx changeset`).
