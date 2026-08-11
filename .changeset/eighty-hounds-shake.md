---
'@amritk/adapters': patch
---

Make the tuple walk position-aware instead of key-aware. Skipping
`enum`/`const`/`default`/`examples` by key name alone also skipped any property
*named* one of them — `default` and `examples` are ordinary property names in
OpenAPI-adjacent documents — leaving a real draft-07 tuple inside that
property's subtree unnormalized, which is the exact harm this module exists to
prevent. The walk now distinguishes a schema node (where those keys are
keywords holding instance data) from a name-to-schema map like `properties`,
`$defs` or `patternProperties` (where they are just names), and takes the
shared `DATA_KEYWORDS` from `@amritk/helpers` rather than restating it.
