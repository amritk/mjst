---
'@amritk/helpers': patch
'@amritk/runtime-validators': patch
---

Give the last two schema walkers the schema-node-versus-name-map distinction,
now that `example` is a data keyword.

Both tested the data keywords by key name alone — the hole every other walker
had already been fixed for — so widening the set turned a latent gap into a
hard failure on a name OpenAPI documents use constantly.
`rewriteDefinitionsRefs` left a `$ref: "#/definitions/Thing"` under a property
named `example` unrewritten while still renaming the block to `$defs`, so the
ref dangled and the generators stopped the build. The runtime registry stopped
registering an `$id` or `$anchor` declared under a property named `example`, so
a `$ref` to it threw "cannot resolve".

`pruneExternalSchemas` also picks up the guards its siblings got: it read
`$ref`/`$dynamicRef` with a bare index and recursed with `for…in`, so a
polluted `Object.prototype` made every object report a ref and nothing was ever
pruned.
