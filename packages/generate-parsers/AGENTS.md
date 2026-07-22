# AGENTS.md — @amritk/generate-parsers

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Generates TypeScript types + runtime parsers from a JSON Schema.

## Commands

```bash
bun run --filter='@amritk/generate-parsers' test
bun run --filter='@amritk/generate-parsers' generate-readme   # after editing config.schema-style docs
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
