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
- **The public signature is positional** and append-only: add new options to the
  **end** of the parameter list so existing callers keep working. Update the
  README + JSDoc when you do.
- Output always includes an `index.ts` barrel and (unless `typesOnly`) runtime
  helper files — golden/snapshot tests assume the full file set.
- Default parsers **coerce**; `strict` makes them throw. Keep both paths tested.
- Shares the `GeneratedFile` = `{ filename, content }` shape with the other
  generators; don't diverge it.

Add a changeset for every change (`bunx changeset`).
