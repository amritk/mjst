---
'@amritk/generate-validators': minor
---

Judge a dynamic key's value, and an array hole, as the value it is.

A `patternProperties` / `additionalProperties` / `unevaluatedProperties` value was
checked in optional mode, so every check wore a leading `value !== undefined &&`
and a property whose value *is* `undefined` satisfied all of them at once:
`{ a: undefined }` passed an `additionalProperties: { type: 'string' }`. The key
came out of a sweep over the object, so it is present by construction and its
value is there to be judged — which is what Ajv and `@amritk/runtime-validators`
both do. `unevaluatedItems` swept with `every`, which skips holes outright, so an
index nothing evaluated went unchecked and `[<hole>]` passed an
`unevaluatedItems: { type: 'string' }`; it materialises the array first now, the
same way the boolean guard already did.

Neither value can come out of `JSON.parse`, so this changes no verdict for a
document parsed from JSON.
