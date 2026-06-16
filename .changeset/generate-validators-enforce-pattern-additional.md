---
"@amritk/generate-validators": minor
---

Generated validators now enforce several constraints they previously accepted
silently, closing gaps a new Ajv differential fuzz test surfaced:

- `patternProperties` values and a schema-form `additionalProperties` are now
  validated (previously only `additionalProperties: false` was enforced, so a
  value matching a pattern — or any extra key under an `additionalProperties`
  schema — passed unchecked).
- `type: 'integer'` now rejects non-integral numbers, and `type: 'null'` is
  enforced, in both the validator and its boolean guard.
- `required` keys with no `properties` entry now get a presence check.
- `propertyNames` and `dependentRequired` are now enforced inside nested inline
  objects, not just at the root.
