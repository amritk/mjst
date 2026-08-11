---
'@amritk/adapters': patch
---

Stop the tuple normalizers from rewriting instance data, and from making
optional tuple positions required.

Both walked every value, `enum`/`const`/`default`/`examples`/`example`
included — but those hold values the schema *describes*. A Zod
`.default({ items: ['a', 'b'] })` came out as
`default: { prefixItems: ['a','b'], minItems: 2, items: false }`: a different
default than the author wrote, handed to consumers as theirs. The walk is
position-aware now — `@amritk/helpers`' `schemaChildren`, so it cannot drift
from the walkers that share it — which also means a property genuinely *named*
`default` or `examples`, and a draft-07 `dependencies` entry named `items`, are
treated as the names they are rather than as keywords.

`enforceTupleLength` raised an explicit `minItems` to the tuple's length. An
explicit `minItems` is the author saying which trailing positions are optional
— Effect's `optionalElement` emits exactly that — so raising it made those
positions required and rejected arrays the source schema accepts. Only a
missing `minItems` is filled in. `items`/`additionalItems` are tested with
`Object.hasOwn`, since a polluted `Object.prototype.items` made every tuple
look like it had a rest element and `items: false` was never written.
