---
"@amritk/validation": patch
"@amritk/mjst": patch
---

Repair through map keys, and make `--branch-errors` free again on valid input.

- **`repairX` repairs positions under `additionalProperties` and `patternProperties`.** The position lookup walked `properties`, `prefixItems` and `items` only, so anything reached through a map key came back with no repairs and the document stayed invalid: `{ inMap: { anyKey: {} } }` against an `additionalProperties` object with a required `name` was left unrepaired. A key now goes to the first pattern it matches, then to `additionalProperties`, the same division the validator and the coercer draw. A declared or pattern-claimed key with nothing to repair toward is never repaired toward `additionalProperties`.
- **`--branch-errors` costs nothing on a combinator that passes.** Each `anyOf` / `oneOf` branch used to be tested by an inline closure that collected its errors as it went, so valid input paid for an error array per branch, and inside a map walk the closure made the engine allocate a scope for every key. A failing branch is now explained by a hoisted `_explainN(value, path)` that runs only after the combinator has failed. On valid input the generated validator does exactly what it does with the option off. Error output is unchanged.
- **Docs.** The `coerceX` speedup over Ajv is stated as what it is: the cost of the clone Ajv needs when it may not mutate its input. In-place Ajv on a large document can come out modestly ahead. `repairX` is described as an autofix tool rather than a stricter validator: accepting only `valid` with an empty `repairs` gives exactly `coerceX`'s verdicts. The migration notes say that `null` is the difference from Ajv you will meet most.
