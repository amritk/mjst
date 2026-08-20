---
'@amritk/generate-parsers': patch
---

Fold the top-level union's fallback into `getDefaultValue`.

`scalarDefaultLiteral` carried a second, weaker per-type table beside the real
one: it answered `[]` for an array with `minItems` and `{}` for an object with
required properties, so the value a top-level union coerced an unmatched input to
was not itself an instance of the branch it was built from. It reads
`getDefaultValue` now — one place that knows what a valid instance looks like,
bounds and required properties and tuple positions included.
