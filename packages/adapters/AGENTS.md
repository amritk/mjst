# AGENTS.md — @amritk/adapters

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Converts TypeBox / Zod / Valibot / Effect schemas into Draft 2020-12 JSON
Schema.

## Commands

```bash
bun run --filter='@amritk/adapters' test
bun run --filter='@amritk/adapters' types:check
```

## Invariants — do not break these

- **No barrel export — one subpath per adapter.** Each `@amritk/adapters/<name>`
  maps to a single file. `getAdapter` is the runtime dispatcher. Don't add a `.`
  root entry.
- **Source libraries (zod/valibot/effect/typebox) are optional peer deps,
  imported dynamically** inside each adapter — never import them at module top
  level, or you'll force every consumer to install all four.
- **`getAdapter('json')` must throw** (JSON needs no adapter). Keep the error
  actionable.
- Unrepresentable constructs widen to `{}` with a `[mjst]` stderr warning
  (Effect throws on nested ones); `strict: true` throws instead. Keep both modes.

Add a changeset for every change (`bunx changeset`).
