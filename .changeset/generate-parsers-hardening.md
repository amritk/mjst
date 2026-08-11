---
'@amritk/generate-parsers': patch
---

Import the types a tuple position references, and compare tuple items
structurally.

`collectImports` never traversed `prefixItems` — nor a nested `if` — but the
type emitter renders a `$ref` there as the referenced type name. So a schema
with `prefixItems: [{ $ref: '#/$defs/Contact' }]` produced a file whose type
reads `[Contact?, …]` with no import for `Contact`: output that does not
compile (TS2304), which is the one failure mode a generator must not have.
Tuple positions are walked at the root and below it now.

A tuple-position ref is imported as a *type*. The parser emitter passes a tuple
element through untouched, so a value import leaves `parseContact` and
`validateContactShape` unused — a `noUnusedLocals` error in the consumer's
build. **This changes the import shape for draft-07 array-valued `items`
tuples**, which previously fell through the generic `items` branch and did get
a value import: `import { type Contact, parseContact, validateContactShape }`
becomes `import type { Contact }`. Nothing generated calls those two bindings
for a tuple position, so the emitted parsers are unchanged. A ref reached from
anywhere other than a tuple position keeps its value import.

`generateValidationExpression` checked `uniqueItems` with a bare `new Set(...)`,
which compares by reference, so `[{a:1},{a:1}]` passed as unique on that path
while every other emitter rejected it. It uses the shared structural check now,
which still emits the cheap scalar form where the item type allows it.

Every key probe and keyword read in the walk is an own-property one, so a
polluted `Object.prototype` cannot make it register an import for a definition
the document never declared — which would name a module that was never emitted.
