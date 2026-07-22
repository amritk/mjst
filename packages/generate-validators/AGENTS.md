# AGENTS.md — @amritk/generate-validators

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Generates lightweight predicate validators (`validateFoo`) + types from a JSON
Schema.

## Commands

```bash
bun run --filter='@amritk/generate-validators' test
bun run --filter='@amritk/generate-validators' types:check
```

## Invariants — do not break these

- **Generated validators return the literal `true` on success**, `{ valid:
  false; errors }` on failure. Do not change the success sentinel — downstream
  code and docs check `result !== true`.
- **`buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?)`** returns
  `GeneratedFile[]` in memory; output always includes a shared
  `validation-result.ts` plus the `index.ts` barrel.
- Draft-07 input is auto-upgraded to 2020-12 — keep that path working.
- Known deliberate quirk: `NaN` satisfies numeric bounds. If you "fix" it, that
  is a behavior change needing a changeset and test updates.

Add a changeset for every change (`bunx changeset`).
