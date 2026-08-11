---
'@amritk/generate-examples': patch
---

Do not let a bad `format` or `pattern` break the run.

`deriveExample` compiled `schema.pattern` unguarded to check a sampled
candidate, so a schema carrying a pattern that is not a valid JavaScript regex
(`*bad`, `a{2,1}`, a duplicate named group) threw a bare `SyntaxError` out of
the generator. An uncompilable pattern now reads as unsatisfied and the
fallback string is emitted — the choice the `patternProperties` compile in the
same file already made.

The format-example table was indexed directly, so `format: "valueOf"` resolved
to a `Function` rather than a string and the emitted `fooExample` carried
`undefined` for that property — a generated file that does not type-check.

`needsValidationFilter` classified keys by name alone, so a schema whose hard
keyword sat under a property named `example` or `default` was reported as
needing no filter — and the generator emitted a derived example without
checking it, so it could ship one the schema rejects. It is position-aware now,
like the walkers in `@amritk/helpers`.
