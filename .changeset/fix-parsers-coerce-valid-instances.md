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

- inline array elements of a scalar item type are now coerced — a `number[]`
  given `[1, 'x', true]` becomes `[1, 0, 1]` — at the top level and for
  properties. The fast path now requires every element to already be well-typed,
  so a mistyped element routes the array to the coercing slow path. Object,
  union, and `$ref` array items keep their existing handling (`$ref` items are
  already parsed per-element; object/union items are not deeply coerced).
