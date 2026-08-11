---
'@amritk/generate-markdown': patch
---

Treat OpenAPI 3.0's singular `example` as instance data, alongside `examples` —
a `$ref`-shaped value under it is a documented config value, not a reference to
inline.
