---
'@amritk/runtime-validators': minor
---

Add `strict` and `checkSchema`, so a schema that says nothing no longer does so quietly.

`{ required: 'name' }` requires nothing, `{ maxlength: 5 }` bounds nothing, and
`{ properties: 'nope' }` describes nothing — each a correct reading of the
specification, and each silent. `checkSchema` reports six kinds of problem: a
keyword carrying the wrong kind of value, a keyword nobody recognizes, a `format`
nobody defines, a value that makes its keyword meaningless (`enum: []`,
`multipleOf: 0`), a constraint the node's own `type` has already ruled out, and a
closed object requiring a property it does not declare.

`{ strict: true }` turns those into a refusal to build, throwing a `SchemaError`
carrying the findings. Off by default, because the permissive reading is the
specification's and an unknown keyword in someone else's document is their
extension rather than your typo.
