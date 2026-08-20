---
'@amritk/generate-validators': patch
---

Sweep an object's keys once. `patternProperties` opened a `for…in` per pattern and
a schema-form `additionalProperties` opened another, so three patterns beside an
`additionalProperties` schema walked the object four times over for a body that is
a handful of `if`s. They share one loop now — same checks, same verdicts, one
pass.
