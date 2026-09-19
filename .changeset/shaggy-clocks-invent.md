---
'@amritk/generate-validators': minor
'@amritk/mjst': minor
---

Add `--coerce`: generated validators that coerce scalars the way Ajv's
`coerceTypes: true` does, and then validate.

For every type `X`, a `coerceX(input) => { valid: true, value } | { valid:
false, errors }` is emitted alongside the existing `validateX` and `isX`, which
are unchanged. It is off by default and costs nothing when off.

**Nothing is substituted.** A value that cannot be coerced into a valid one
reaches the validator untouched, so the error names what the caller actually
wrote, with the keyword and params that rejected it. `maxRetries: "many"` is an
error, not a `0`. And the constraint keywords run on the coerced value, so
`"3"` against `{ type: 'integer', minimum: 5 }` becomes `3` and *then* fails
`minimum` — an answer neither a strict parser nor a repairing one can give.

**The input is never modified.** `value` is the input itself when nothing needed
coercing, and otherwise a copy sharing everything the coercion did not touch, so
callers do not pay for the defensive clone an in-place coercer forces.

The scalar table is Ajv's, checked against Ajv cell by cell rather than
reconstructed from its documentation — which matters, because the corners are
not what the docs suggest: a whitespace-only string coerces to `0`, `null`
coerces to every scalar type, `""`/`0`/`false` coerce to `null`, `"007"` is `7`,
and `"Infinity"` is an *integer* (Ajv's test is `!(data % 1)`, and `Infinity % 1`
is `NaN`, which is falsy). A differential fuzz compares both the verdict and the
coerced value against Ajv across several thousand cases.

Positions where the schema says more than one thing — an array-form `type`, a
combinator branch — are left alone rather than guessed at. Ajv resolves those by
walking its own coercion list in order, which turns `"1"` into `1` under
`["number", "string"]` and leaves it a string under `["string", "number"]`; that
is a fact about the order of Ajv's list rather than about the schema, and
quietly changing a value on the strength of it is the one thing a coercing
validator must not do. Declining costs a coercion that could have been made and
never makes a wrong one.
