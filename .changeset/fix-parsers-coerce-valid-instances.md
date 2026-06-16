---
"@amritk/generate-parsers": minor
---

Make the coercing parser return a value that is actually a valid instance of the
generated type, closing gaps a new Ajv conformance differential test surfaced:

- `enum`: a non-member now coerces to the first member (both at the top level and
  for properties) instead of passing through — the generated type is the literal
  union, so any other value was not of that type.
- top-level `const` now coerces a non-matching value to the const value.
- top-level `anyOf` / `oneOf` now validate membership and default an unmatched
  value to a member-shaped value, instead of passing input through unchanged.
- `type: 'null'` is now coerced to `null` at the top level and for properties.
- the non-object fallback and object-property coercion now fill required `const`,
  `null`, and nested-object properties with complete defaults (a shared
  `getDefaultValue`), so the fallback object is itself valid rather than `{}`.

Inline (non-`$ref`) array *element* coercion remains a known limitation — a
`number[]` validates that the value is an array but does not yet coerce each
element; use a `$ref` item schema for deep element parsing.
