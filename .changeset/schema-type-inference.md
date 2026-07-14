---
"@amritk/generate-parsers": patch
---

fix: infer a branch's type from its keywords when generating union
discrimination checks. Previously a `oneOf`/`anyOf` branch written without an
explicit `type` (e.g. `{ properties, required }` or `{ minLength: 1 }`) emitted
no checks and matched anything, breaking discrimination. `generateSchemaChecks`
now infers `object` from `properties`/`required`/etc., `array` from
`items`/`minItems`/`maxItems`, `string` from `minLength`/`pattern`, `number`
from `minimum`/`multipleOf`, `boolean`/`null` from `const`, and `null` from an
all-null `enum`, scoring keyword categories and resolving ties in
`object > array > string > number` order.
