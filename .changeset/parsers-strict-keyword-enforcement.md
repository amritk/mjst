---
"@amritk/generate-parsers": patch
---

fix: enforce JSON Schema keywords that strict parsers previously ignored.

Strict-mode parsers silently accepted input violating `contains` /
`minContains` / `maxContains`, `dependentRequired`, `dependentSchemas`, and
`propertyNames` — none of these keywords appeared anywhere in the generator, so
a strict parser contradicted its "throws on violations" contract. Ported the
enforcement from `@amritk/generate-validators`:

- **`contains` / `minContains` / `maxContains`** — a strict parser now throws
  unless the number of array items matching the `contains` subschema is within
  `[minContains (default 1), maxContains (default ∞)]`. `minContains: 0` makes
  the lower bound trivially satisfied. Enforced on both array properties and
  root arrays (including arrays of `$ref`/object items).
- **`dependentRequired`** — when a trigger key is present, its declared
  dependencies must be present too.
- **`dependentSchemas`** — when a trigger property is present, the whole object
  must match the associated subschema (`false` forbids the trigger; `true` is a
  no-op).
- **`propertyNames`** — every object key must satisfy the name subschema,
  including the common constrained-key-map form (`{ type: 'object',
  propertyNames: { … } }`) with no declared `properties`.

Enforcement is backed by a self-contained, both-directions-sound subschema
matcher (type-aware, so `propertyNames: { maxLength: 3 }` correctly constrains
keys). The parser fast path, shallow guard, and shape validator all bail when a
schema carries one of these keywords, so a clean-input fast path can never skip
the checks.

Also adds a generation-time guard (strict mode only, mirroring the validators'
`assertNoUnsupportedKeywords`): generating a strict parser now throws for
`unevaluatedProperties` / `unevaluatedItems` with a constraining value, and for
a `contains` / `propertyNames` / `dependentSchemas` subschema the generator
cannot prove inline (a `$ref`, a combinator, …) — instead of silently emitting a
permissive parser. Coercing (non-strict) parsers are unchanged: they are
documented to repair rather than reject, so they still ignore these keywords.
