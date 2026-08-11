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
