---
'@amritk/generate-markdown': patch
---

Treat OpenAPI 3.0's singular `example` as instance data alongside `examples`,
and add `dependencies` to the schema-map keywords. A `$ref`-shaped value under
`example` is a documented config value, not a reference to inline; and
`dependencies` keys are trigger property names, so an entry named `default` was
read as the data keyword and documented as a raw `{"$ref": …}` instead of the
schema it names.
