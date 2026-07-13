---
"@amritk/generate-validators": patch
---

fix: close correctness gaps in the validator generator without changing the
generator's intentional shallow array-item behaviour.

- **Object-level combinators are no longer ignored by the flat guards.** For a
  schema that pairs `properties` with `allOf`/`anyOf`/`oneOf`/`not`/`if`, the
  fast-path guard and the boolean type-guard (`isX`) previously short-circuited
  to `true`, accepting documents the combinator rejects. Such schemas now fall
  through to the enforcing validator.
- **`dependentSchemas` is now implemented** (previously silently ignored): when a
  trigger property is present the whole object is validated against the
  associated subschema. `$ref`s reached only through `dependentSchemas` are now
  imported, and both flat guards bail on the keyword.
- **Cleaner error paths.** Errors emitted inside `if`/`then`/`else`, combinator
  branches, and dynamic-key values no longer contain `//` or a trailing `/`.

Also documents that a `NaN` value satisfies a constrained-number schema (matching
the interpreter). Array items remain shape-checked only — a deliberate throughput
tradeoff — with `isX` kept in exact lockstep with `validateX`.
