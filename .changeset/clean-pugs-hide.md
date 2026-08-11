---
'@amritk/adapters': patch
---

Stop the tuple normalizers from rewriting instance data, and stop them from
making optional tuple positions required.

Both walkers recursed into every value, `enum` / `const` / `default` /
`examples` included — but those hold values the schema *describes*, not
subschemas. An object under one that happens to have an `items` array is that
value's own property, so a Zod `.default({ items: ['a', 'b'] })` came out as
`default: { prefixItems: ['a','b'], minItems: 2, items: false }`: a different
default than the author wrote, handed to consumers as theirs. Both walkers now
skip the data keywords.

`enforceTupleLength` raised an explicit `minItems` to the tuple's length. An
explicit `minItems` is the author saying which trailing positions are optional
— Effect's `optionalElement` emits exactly that — so raising it made those
positions required and rejected arrays the source schema accepts. Only a
missing `minItems` is filled in now.
