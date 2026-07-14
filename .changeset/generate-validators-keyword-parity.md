---
"@amritk/generate-validators": patch
---

Close verdict gaps where a generated validator was silently more permissive than
`@amritk/runtime-validators` for the same schema. The generator now emits checks
for keywords the interpreter already enforced but the generator skipped:

- `minProperties` / `maxProperties` — the object's key count is now bounded.
- draft-07 dual-form `dependencies` — the array form requires the listed keys and
  the schema form applies the subschema to the whole object when the trigger key
  is present (a `false` subschema makes the trigger's mere presence invalid).
- OpenAPI 3.0 `nullable: true` — a `null` value is accepted regardless of the
  declared `type` (and short-circuits sibling keywords), folded into the `anyOf`
  form the generator already enforces so nested and property-level `nullable`
  work too.
- Full `propertyNames` subschemas — every key is validated against the entire
  subschema (combinators, `type`, `multipleOf`, …), not just
  `pattern`/`minLength`/`maxLength`/`enum`/`const`/`$ref`.

The allocation-free happy-path guard (and the `isX` boolean guard) bail to the
error-collecting path for `minProperties`/`maxProperties`/`dependencies` — and,
via the `nullable`→`anyOf` rewrite, for `nullable` — so their fast-path verdict
can never disagree with the validator. Differential tests assert generator vs
interpreter verdict parity across these keywords.
