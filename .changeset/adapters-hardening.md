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
position-aware now — `@amritk/helpers`' shared position predicates, so it
cannot drift from the walkers that share them — which also means a property genuinely *named*
`default` or `examples`, and a draft-07 `dependencies` entry named `items`, are
treated as the names they are rather than as keywords.

`enforceTupleLength` raised an explicit `minItems` to the tuple's length. An
explicit `minItems` is the author saying which trailing positions are optional
— Effect's `optionalElement` emits exactly that — so raising it made those
positions required and rejected arrays the source schema accepts. Only a
missing `minItems` is filled in, and only for a non-empty tuple — stamping
`minItems: 0` onto an empty one would put a keyword in the output that the
source never declared. Every `items`/`additionalItems`/`prefixItems` read is
an own-property read, since a polluted `Object.prototype.items` made every
node look like a tuple — `items: false` was never written, and nodes gained a
tuple bound they never declared.
