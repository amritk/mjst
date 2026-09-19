---
'@amritk/runtime-validators': minor
'@amritk/generate-validators': minor
---

Explain a failing `anyOf` / `oneOf` with the errors of the branch that was
plainly the one meant.

"must match a schema in anyOf" names no field and no reason. The branch errors
were already computed to answer the yes/no question, and generated validators
threw all of them away — so a typo in one field of a union-rooted definition
pointed at the whole object rather than at the field. The interpreter already
surfaced them for a discriminated union; generated validators did not surface
them at all.

Both now select a branch by the same rule, so a generated validator and the
interpreter explain a failing union the same way. Branches that rejected the
value's *kind* are dropped first: a branch wanting a string has nothing to say
about an object, which leaves a `string | { … }` union — the commonest shape in
a hand-written config schema — with the one branch that was talking about this
value. When several branches survive they all describe the same kind of value,
and the tie is broken the way a discriminated union reads from the outside: if
every survivor but one was rejected on the value's identity (a `const` or `enum`
on the value or one of its own properties), that one is the variant.

Nothing extra is reported when no branch stands out, which is as much as can be
said honestly. "The branch with the fewest errors" would answer here too, and
answers wrongly on `oneOf: [aReference, theActualThing]`.

The combinator's own error still comes first, so code matching on `keyword ===
'anyOf'` is unaffected. Errors a reported branch produces now carry their real
instance path: inside a match expression they were written relative to the
validator root, which nothing could observe while they were being discarded.
