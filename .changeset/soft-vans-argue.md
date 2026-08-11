---
'@amritk/generate-parsers': patch
---

Import the types a tuple position references, and compare tuple items
structurally.

`collectImports` never traversed `prefixItems`, but the type emitter renders a
`$ref` there as the referenced type name — so a schema with
`prefixItems: [{ $ref: '#/$defs/Contact' }]` produced a file whose type reads
`[Contact?, ...]` with no import for `Contact`. That output does not compile
(TS2304), which is the one failure mode a generator must not have.

`generateValidationExpression` checked `uniqueItems` with a bare
`new Set(...)`, which compares by reference, so `[{a:1},{a:1}]` passed as
unique on that path while every other emitter — all of which go through
`generateUniqueItemsCheck` — rejected it. It now uses the same shared check,
which still emits the cheap scalar form where the item type allows it.
