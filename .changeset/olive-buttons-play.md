---
'@amritk/generate-examples': patch
---

Ignore a `format` that names an `Object.prototype` member. The example table
was indexed directly, so `format: "valueOf"` (or `toString`, `constructor`)
resolved to a `Function` rather than a string — and the emitted `fooExample`
carried `undefined` for that property, producing a generated file that does not
type-check.
