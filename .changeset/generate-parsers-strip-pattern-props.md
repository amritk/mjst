---
"@amritk/generate-parsers": patch
---

Fix `stripUnknown` dropping keys that `patternProperties` declares. For a schema with `patternProperties` (and no `additionalProperties: false`, no `$ref` pattern), the parser fell back to the plain object parser, whose strip logic only knows the declared `properties` — so `stripUnknown` removed pattern-matching keys along with genuinely-undeclared ones. `{ a, patternProperties: { '^x-': ... } }` with input `{ a: 'ok', 'x-keep': 'yes', junk: 'x' }` dropped `x-keep`. The coerce-mode `stripUnknown` path now uses the selective combined copy, keeping declared and pattern-matching keys and dropping only the truly-undeclared ones — matching the interpreter.
