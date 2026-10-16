---
'@amritk/validation': patch
---

Generated `isX` guards no longer fall back to `validateX(input) === true` for schemas with a `$ref`, `patternProperties` or a union. They are yes/no checks that build no errors and stop at the first failure, answering a `$ref` with the target's own `isX`. `coerceX` now answers an already-valid document with that guard instead of a coercion walk plus `validateX`, and the union branches inside `validateX` use it too. Each named property is read into a local once, ahead of its checks. Verdicts, errors and coerced values are unchanged; the generated code is different.
