---
"@amritk/generate-parsers": patch
---

Parse and assert JSON Schema 2020-12 tuples (`prefixItems`) per position. The
generated parsers previously left tuple positions untouched — every `items`
code path bailed on the array form, so a mistyped position was never coerced
(safe mode) or rejected (strict mode) and the value fell through to a generic
cast, despite the README listing tuples as handled.

Now, mirroring the validators' tuple handling:

- Safe mode coerces each declared position through its own subschema and, when
  a sibling `items: false` (or draft `additionalItems: false`) caps the length,
  drops any element past the tuple. A shorter input keeps its absent trailing
  positions; a non-array coerces to an empty array.
- Strict mode asserts each present position against its subschema (scalar type,
  enum, or a `$ref`/inline schema resolved via the root document) and throws on
  extra elements when the length is capped.
- The fast-path type check and shape validators require a tuple's present
  positions to be well-typed, so a mistyped tuple is routed to the coercing or
  asserting slow path instead of short-circuiting through the fast path.
