---
'@amritk/generate-parsers': patch
---

Close the strict parser's silent-acceptance gaps across the composition and
constraint keywords. A strict parser promises to throw on anything the schema
rejects; each of these was accepted instead, because the keyword appeared in
neither the fast-path guard nor the slow-path assertions:

- `const` on a property — scalar, structural (compared by deep equality, key
  order included) and `const: null`.
- `minProperties` / `maxProperties` — at the root, on a property, and on the
  property-less object and record parsers.
- `required` on a schema with no `properties`.
- `not`, at the root and on a property. Enforced through the exact subschema
  matcher; a subschema the matcher cannot prove is now a generation-time error,
  joining `contains` / `propertyNames` / `dependentSchemas`.
- `allOf` members that carry constraints rather than an object shape, and object
  members of a type-less `allOf` root.
- `if` / `then` / `else`.
- `patternProperties` value schemas, and the value constraints of a
  schema-valued `additionalProperties` beyond its bare `type`.
- Array `items` richer than a scalar or enum — a nested array, a union, a
  bounded string — which previously contributed no element check at all.
- `minItems` / `maxItems` on a root array whose items are objects or `$ref`s.
- The object shape (`properties`, `required`, …) of a nullable
  (`["object","null"]`) property.
- Boolean property schemas: `false` now rejects the key, and `true` no longer
  blanks the value to `undefined` — which made a strict parser mutate a value it
  had just accepted.

The fast-path guard and the exported shape validator decline any schema carrying
a keyword they cannot mirror, so a value can no longer be waved through before
the assertions run. `subschemaMatchExpr` gained `allOf` / `anyOf` / `oneOf` /
`not` / `if`-`then`-`else` support (so `contains`, `propertyNames`,
`dependentSchemas` and array items handle combinators too), switched
`uniqueItems` to the structural comparison the rest of the package uses, and
casts its object accessors so the generated code type-checks.

A new differential fuzz suite holds this surface against Ajv.
