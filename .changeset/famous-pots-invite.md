---
'@amritk/runtime-validators': patch
---

Iterate own keys without allocating. The `additionalProperties`,
`propertyNames` and `unevaluatedProperties` sweeps switched to `Object.keys` to
stop walking the prototype chain, which added a key-array allocation per object
on the interpreter's hottest loop — up to three per validated object. A
`for…in` with an `Object.hasOwn` guard has the identical semantics and
allocates nothing.
