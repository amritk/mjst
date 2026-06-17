---
"@amritk/runtime-validators": patch
---

Fix two interpreter divergences from Ajv surfaced by differential fuzzing:

- `patternProperties` now applies to keys that are also declared in
  `properties`. Previously such a key was skipped entirely, so a value matching
  both a `properties` entry and a `patternProperties` regex was only checked
  against the former (e.g. `{ num_x: [1] }` wrongly passed
  `properties.num_x` + `patternProperties['^num_']: { type: 'integer' }`).
- `additionalProperties: true` now annotates every additional property as
  evaluated, mirroring `items: true` for arrays, so a sibling
  `unevaluatedProperties: false` no longer rejects those properties.
