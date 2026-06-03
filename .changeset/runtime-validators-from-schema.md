---
"@amritk/runtime-validators": minor
---

Add the `FromSchema` type helper, which infers the TypeScript type of data a JSON
Schema accepts when the schema is written `as const`. `validate` and
`validateGuard` now infer their output type from the schema via a `const` type
parameter, so guards narrow and validators carry their accepted type without a
hand-written annotation; the new `Infer` helper recovers that type from a built
validator or guard. Runtime-only keywords (lengths, patterns, numeric bounds) are
correctly ignored, and `$ref`/`not`/`if`-`then`-`else` are skipped so the inferred
type stays useful.
