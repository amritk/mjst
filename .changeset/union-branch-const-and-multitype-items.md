---
'@amritk/generate-parsers': patch
---

Two more repairs a coercing parser was not making, both found by re-running the
output-validity fuzz on fresh seeds.

A `const` union branch was checked by its *inferred type* rather than by its
value: `{ anyOf: [{ const: 'a' }, { type: 'boolean' }] }` compiled the first
branch to `typeof x === "string"`, so the union reported a match for `""` and the
parser handed back a value the schema rejects. A `const` pins the value to one
literal, so the structural equality is now the whole check — which is also
smaller output, since the type test it stood in for is implied by it.

Array `items` declared with an array-form `type` (`{ items: { type: ['string',
'null'] } }`) were passed through untouched, because the "can this element be
coerced?" test only recognised a single `type`. A multi-type item whose members
are all scalars is coerced element-wise like any other.
