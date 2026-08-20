---
'@amritk/generate-validators': patch
'@amritk/helpers': patch
---

Read every schema keyword as the node's own property.

The generators asked `'items' in schema` and read `schema.type` straight off the
node, and both walk the prototype chain. With `Object.prototype.items` set — by a
dependency with a prototype-pollution bug, or simply by a schema built over a base
object — every node in the document answered "yes" to keywords none of them
declared, and the result was a *different validator*: an inherited `items: false`
made every array have to be empty, an inherited `patternProperties` swallowed the
`additionalProperties` sweep so unknown keys stopped being reported, and an
inherited `if`/`then`, `allOf` or `contains` sent a walker into unbounded
recursion, so `buildValidatorSchema` threw a `RangeError` instead of generating.

`@amritk/helpers/own-keyword` is the shared reader — the question
`@amritk/helpers/schema-guards` and `@amritk/runtime-validators` already ask, for
the keywords with no named guard. Generated output is unchanged for every schema
in the conformance corpus and the vendored OpenAPI fixtures.
