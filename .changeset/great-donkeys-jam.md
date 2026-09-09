---
'@amritk/runtime-validators': minor
---

Split `validate` into a hot guard and a cold error-collecting half, and explain a failing `anyOf`/`oneOf`.

Collecting errors is not free even when there are none: the error-mode step
carries the path string it would need to report a failure and cannot
short-circuit. `validate` and `assert` now run the boolean guard first and only
fall through to the error-collecting half once something has actually failed —
the split `@amritk/generate-validators` already emits. Valid input gets 1.75-2.4x
on the bench schemas; invalid input pays a second walk, which is the right way
round.

Separately, "must match a schema in anyOf" names no field and no reason, and on a
discriminated union — where the value plainly is one of the variants and one field
of it is wrong — that is the least useful thing a validator can say. On failure
each branch is now asked why it did not match, and when every branch but one was
rejected on the value's identity (a `const` or `enum` on one of its own
properties) that one's errors are added under the combinator's own. A 24-variant
union with a bad payload now reports `must be integer at /payload/b` instead of a
single error pointing at the root.
