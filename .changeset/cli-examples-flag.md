---
"@amritk/mjst": minor
---

Add an `--examples` flag (config `"examples": true`) that wires
`@amritk/generate-examples` into the CLI.

When set, alongside the parser output mjst also emits a `fast-check` arbitrary
(`FooArbitrary`) and a concrete example value (`fooExample`) for every schema.
The test-data files are written into an `examples/` subdirectory of the output
destination so they never collide with the parser files (both otherwise produce
`<name>.ts` / `index.ts`). The flag works with both `--schema` and
`--schema-dir` — under `--schema-dir` the examples mirror the schema layout
beneath `examples/`.

The generated arbitraries import `fast-check`, which consumers must install as a
(dev) dependency; the static example values have no runtime dependencies. The
example sources are intentionally left out of `--build`.
