---
"@amritk/generate-examples": minor
---

Derive example values that actually satisfy more of their schema. `deriveExample`
previously ignored many constraints and emitted values that fail their own
schema; a new Ajv differential test now guards against that. It now honors:

- numeric `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, and `multipleOf`
  (not just `minimum`), picking a value inside the bounds.
- array `maxItems` (the count is clamped into `[minItems, maxItems]`, so
  `maxItems: 0` yields `[]`) and tuple schemas (`prefixItems`, and the draft-07
  array-form `items`), deriving one value per position.
- object `required` keys that have no `properties` entry (filled from
  `additionalProperties` when it is a schema, else `null`).
- `allOf`, by merging the branches (properties combined, `required` unioned,
  numeric/length bounds tightened) instead of returning `null`.
- `enum` (and `const`) members alongside a length/range constraint — the first
  member that also satisfies it is chosen rather than blindly the first.
- `minProperties` (filler keys are synthesized when extras are allowed),
  `uniqueItems` (primitive items are perturbed to stay distinct), `contains` /
  `minContains` (enough items satisfy the contained schema), and `pattern` via a
  best-effort regex sampler covering the common building blocks (anchors,
  character classes, `\d`/`\w`/`\s`, and quantifiers), verified against the real
  regex before use.

Alternation/group patterns and otherwise unsatisfiable schemas remain
best-effort; use the generated `fast-check` arbitrary when full fidelity is
required.
