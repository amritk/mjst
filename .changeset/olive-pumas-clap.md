---
'@amritk/generate-parsers': patch
---

Traverse a nested `if` subschema when collecting imports. The comment said
"Traverse into if/then/else branches" but only `then` and `else` followed, so a
`$ref` in an `if` was collected at the root and missed one level down — the same
root-versus-nested disagreement that lost tuple imports.
