---
'@amritk/generate-parsers': patch
---

Import the types a tuple position references, and compare tuple items
structurally.

`collectImports` never traversed `prefixItems` — nor draft-07's array-valued
`items`, nor a nested `if` — but the type emitter renders a `$ref` there as the
referenced type name. So a schema with `prefixItems: [{ $ref: '#/$defs/Contact' }]`
produced a file whose type reads `[Contact?, …]` with no import for `Contact`:
output that does not compile (TS2304), which is the one failure mode a
generator must not have. Tuple positions are walked at the root and below it
now, in both spellings.

Those refs are imported as *types*. The parser emitter passes a tuple element
through untouched, so the full value import left `parseContact` and
`validateContactShape` unused — a `noUnusedLocals` error in the consumer's
build. A ref reached from anywhere else keeps its value import.

`generateValidationExpression` checked `uniqueItems` with a bare `new Set(...)`,
which compares by reference, so `[{a:1},{a:1}]` passed as unique on that path
while every other emitter rejected it. It uses the shared structural check now,
which still emits the cheap scalar form where the item type allows it.

Every key probe and keyword read in the walk is an own-property one, so a
polluted `Object.prototype` cannot make it register an import for a definition
the document never declared — which would name a module that was never emitted.
