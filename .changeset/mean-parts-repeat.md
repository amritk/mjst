---
'@amritk/runtime-validators': patch
---

Give the limits walker the schema-node-versus-name-map distinction. It skipped
the data keywords by name alone, so a definition or property named `default`,
`example` or `examples` was never descended into — which meant an `$id`
declared under it did not register (making the `schema-registry` fix
unreachable and the `$ref` to it fail), and a `pattern` under it was never
screened, so a catastrophic-backtracking regex compiled and ran with no
`allowUnsafePatterns` opt-in. It also iterated with `for…in`, so a polluted
`Object.prototype.pattern` made every schema in the process fail screening.
