---
'@amritk/parsers': minor
'@amritk/helpers': minor
'@amritk/mjst': minor
---

Add `--repair`: validators that coerce, validate, and then repair — reporting the
errors they repaired.

`--coerce` moves a value that is already right but written in the wrong type, and
substitutes nothing. A coercing parser substitutes freely and reports nothing. The
gap between them is the common case: a document you want to accept as far as it
can be accepted, while still being told what you had to accept it *despite*.

`repairX(input)` returns `RepairResult<T>` — `{ valid: true, value, repairs }`, or
`{ valid: false, value, errors, repairs }` when something could not be repaired. It
coerces, runs the very same `validateX`, repairs each rejected position to a value
the schema itself supplies — a `default`, a `const`, the first `enum` member, or a
fallback built to satisfy that position's own bounds — and re-validates, until the
document is accepted or nothing further can be repaired.

**The repairs are the validator's own errors.** Not a parallel account of what went
wrong, but the same objects, with the same `path`, `keyword` and `params` the value
would have been rejected with. That is the point of driving repair from the errors
rather than threading a collector through the emitters: a caller logging a repair
logs exactly what a rejection would have said, and the two cannot drift apart
because there is only one of them.

Read the verdict by the tolerance you want. A document needing nothing is `valid:
true` with an empty `repairs`. One fully repaired is `valid: true` with a non-empty
one, so `valid` alone does not tell you the input was clean — check `repairs.length`
when that matters. One that could not be fully repaired is `valid: false` carrying
both what was repaired and what is still wrong with the value handed back.

**How much it will substitute.** Everything `@amritk/generate-parsers` substitutes in
its coercing mode, down to fabricating an `"xxx"` for a `minLength: 3` and building a
whole object for a root that arrived as `"nope"`. A differential test pins that: the
same schema and the same document through both engines produce the same result. They
can, because `getDefaultValue` and `generateDefaultFromPattern` moved into
`@amritk/helpers` and both now read one table rather than two that agree today. The
one deliberate difference is `minItems`, where a short array is padded here and left
short by the parser — so the parser can hand back a document its own schema rejects
and this cannot.

The input is never modified, everything a repair did not touch is shared rather than
copied, a position is repaired at most once so an unsatisfiable schema reports rather
than spins, and whatever comes back `valid: true` is a value `validateX` accepts.

Off by default; on the CLI it is `--repair`, which implies `--coerce` and needs
`--validators`. Also documents `coerce` and `branchErrors` in the
`buildValidatorSchema` signature, which the README and AI.md had not caught up with.
