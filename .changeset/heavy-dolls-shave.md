---
'@amritk/resolve-refs': patch
---

Treat OpenAPI 3.0's singular `example` as instance data. `@amritk/helpers`
gained it, but the resolver runs first in the pipeline and its own
`VALUE_KEYWORDS` did not — so a `$ref` inside an `example` value was still
inlined, replacing the literal the author wrote with another document's
contents before any later walker got the chance to leave it alone.
