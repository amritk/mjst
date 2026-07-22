# AGENTS.md — @amritk/generate-examples

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Generates fast-check arbitraries (`FooArbitrary`) and concrete example values
(`fooExample`) from a JSON Schema.

## Commands

```bash
bun run --filter='@amritk/generate-examples' test
bun run --filter='@amritk/generate-examples' types:check
```

## Invariants — do not break these

- **`fast-check` is an optional peer dep** of the *generated output*, not a
  runtime dep of this generator. Generated arbitrary files `import * as fc from
  'fast-check'`; static `fooExample` values must stay dependency-free.
- **Two output kinds:** `generateArbitrary` / `generateExampleConst` return
  source-code **strings**; `deriveExample` returns a runtime **value**;
  `serializeValue` turns a value into a TS source expression. Keep that
  distinction crisp.
- Unsupported keywords degrade gracefully (`fc.anything()` / `null`) rather than
  throwing — preserve that, and note new gaps in tests.

Add a changeset for every change (`bunx changeset`).
