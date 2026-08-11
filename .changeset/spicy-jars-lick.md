---
'@amritk/adapters': patch
---

Treat draft-07 `dependencies` as the name-to-schema map it is. Its keys are
trigger property names, so a dependency declared on a property called `items`
— `dependencies: { items: ['a', 'b'] }`, meaning "if `items` is present, `a`
and `b` are required" — was read as a tuple keyword and rewritten into
`{ prefixItems: ['a','b'], minItems: 2, items: false }`, destroying the
declaration outright in the one module whose whole job is draft-07
normalization.
