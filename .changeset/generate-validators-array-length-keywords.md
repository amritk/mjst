---
"@amritk/generate-validators": minor
---

Enforce the array and combinator keywords the generator previously parsed but
ignored, proven against Ajv by the differential fuzz test:

- Array: `minItems`, `maxItems`, `uniqueItems` (dedupes by a JSON projection —
  exact for primitives, the same projection the boolean guard uses),
  `contains` / `minContains` / `maxContains`, and tuple `prefixItems` with a
  length cap from `items: false` / `additionalItems: false`.
- Combinators: `allOf` (conjunction, errors surfaced per branch), `anyOf`,
  `oneOf` (exactly one), `not`, and `if` / `then` / `else` — built on a shared
  "does this value match this subschema" boolean primitive — both as object
  properties and as a top-level schema.

The generated `isX` type guard bails to the validator for schemas carrying any of
these so it never disagrees with the slow path. Still out of scope: validating
constraints on a top-level non-object schema (e.g. a root `{ type: 'array',
minItems }`), and `$ref` inside a `contains` / combinator branch in single-file
output (it requires the referenced validator to be in scope).
