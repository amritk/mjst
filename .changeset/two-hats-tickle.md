---
'@amritk/generate-parsers': patch
---

Walk tuple positions before the branches that return early. The `prefixItems`
traversal added to `collectImports` sat after the `additionalProperties`- and
`items`-with-`$ref` branches, both of which `return`, so a tuple with a `$ref`
rest element never reached it: `prefixItems: [{$ref: '#/$defs/Contact'}],
items: {$ref: '#/$defs/Tail'}` imported `Tail` and not `Contact`, and the
emitted file failed to compile with TS2304 — the precise failure the traversal
was added to eliminate.
