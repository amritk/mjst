---
"@amritk/generate-validators": patch
---

fix: close several correctness gaps in the validator generator so generated
`validateX`/`isX` match the runtime interpreter.

- **Object-level combinators are no longer ignored by the flat guards.** For a
  schema that pairs `properties` with `allOf`/`anyOf`/`oneOf`/`not`/`if`, the
  fast-path guard and the boolean type-guard (`isX`) previously short-circuited
  to `true`, accepting documents the combinator rejects. Such schemas now fall
  through to the enforcing validator.
- **Array items are validated in full.** `items` subschemas were only
  type-checked; nested object properties, string/number constraints, enums, and
  nested arrays on items are now enforced (recursing to any depth), matching the
  interpreter. A sparse hole is correctly rejected as an invalid item.
- **`dependentSchemas` is now implemented** (previously silently ignored): when a
  trigger property is present the whole object is validated against the
  associated subschema. `$ref`s reached only through `dependentSchemas` are now
  imported.
- **Cleaner error paths.** Errors emitted inside `if`/`then`/`else`, combinator
  branches, and dynamic-key values no longer contain `//` or a trailing `/`.

Also documents that a `NaN` value satisfies a constrained-number schema (matching
the interpreter), and keeps `isX` in exact lockstep with `validateX` for all of
the above.
