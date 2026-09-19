---
'@amritk/runtime-validators': minor
'@amritk/generate-validators': minor
'@amritk/mjst': minor
---

Explain a failing `anyOf` / `oneOf` with the errors of the branch that was
plainly the one meant. In generated validators this is `--branch-errors`, off by
default; the interpreter does it always, on the cold path it already had.

"must match a schema in anyOf" names no field and no reason. The branch errors
are computed anyway to answer the yes/no question, and generated validators threw
all of them away — so a typo in one field of a union-rooted definition pointed at
the whole object rather than at the field.

Both now select a branch by the same rule. Branches that rejected the value's
*kind* are dropped first: a branch wanting a string has nothing to say about an
object, which leaves a `string | { … }` union — the commonest shape in a
hand-written config schema — with the one branch that was talking about this
value. When several survive they all describe the same kind of value, and the tie
is broken the way a discriminated union reads from the outside. Nothing extra is
reported when no branch stands out; "the branch with the fewest errors" would
answer here too, and answers wrongly on `oneOf: [aReference, theActualThing]`.

**Why it is a flag.** Collecting branch errors costs about 30% of the throughput
of a *valid* instance against a union-rooted schema, because each branch is
handed a collector it closes over. Off, the generated code is exactly what it
would be without the option — no buffer, no collector, byte for byte. On, the
buffer is created by the first branch that has something to put in it, so a value
matching the first branch still allocates nothing; an eagerly-created one cost
40% rather than 30%.

The combinator's own error still comes first, so code matching on `keyword ===
'anyOf'` is unaffected. Errors a reported branch produces now carry their real
instance path.
