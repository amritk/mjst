---
"@amritk/generate-validators": patch
---

fix: close correctness gaps in the validator generator.

- **Array items are now validated in full**, matching the interpreter: an item's
  nested `properties`/`required`/`additionalProperties`, scalar constraints
  (`minLength`, `minimum`, …), and nested arrays are all enforced, recursing to
  any depth. Previously only the item's top-level type was checked, so e.g.
  `items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }`
  accepted `[{ a: 123 }]` and `[{}]`. A sparse hole is correctly rejected. `isX`
  reaches the identical verdict. (Bare-type item arrays like `string[]` are
  unaffected; validating richer item contents costs throughput proportional to
  the per-item work.)
- **Object-level combinators are no longer ignored by the flat guards.** For a
  schema pairing `properties` with `allOf`/`anyOf`/`oneOf`/`not`/`if`, the
  fast-path guard and `isX` previously short-circuited to `true`, accepting
  documents the combinator rejects. Such schemas now fall through to the
  enforcing validator.
- **`dependentSchemas` is now implemented** (previously silently ignored): when a
  trigger property is present the whole object is validated against the
  associated subschema. `$ref`s reached only through `dependentSchemas` are now
  imported, and both flat guards bail on the keyword.
- **Cleaner error paths.** Errors inside `if`/`then`/`else`, combinator branches,
  and dynamic-key values no longer contain `//` or a trailing `/`.

Also documents that a `NaN` value satisfies a constrained-number schema (matching
the interpreter).
