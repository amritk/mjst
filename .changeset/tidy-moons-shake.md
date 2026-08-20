---
'@amritk/generate-examples': patch
---

Two more ways a generated file could fail to compile or throw at import.

- A non-finite numeric bound was emitted verbatim. `1e999` is legal JSON and
  `JSON.parse` turns it into `Infinity`, which the numeric keyword guards accept
  — so `{ minimum: 1e999 }` produced `fc.double({ …, min: Infinity })`, and every
  bounded `fc.*` combinator throws on that the moment the module is imported.
  Non-finite bounds (and a non-finite or non-positive `multipleOf`) are now
  treated as absent.
- An authored `default` / `examples[0]` was emitted verbatim even when it
  contradicted its own schema. The generated type follows the schema, not the
  hint, so `{ type: 'string', default: 42 }` produced
  `const fooExample: string = 42`. A hint is now used only when it validates;
  otherwise the value is derived structurally. `const` is unaffected — the type
  is the const's own literal type, so the two cannot disagree.
