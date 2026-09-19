---
'@amritk/generate-validators': minor
'@amritk/mjst': minor
---

Add `--coerce`: generated validators that coerce scalars toward what the schema
declares, and then validate.

For every type `X`, a `coerceX(input) => { valid: true, value } | { valid:
false, errors }` is emitted alongside the existing `validateX` and `isX`, which
are unchanged. Off by default and free when off.

**Nothing is substituted.** A value that cannot be coerced into a valid one
reaches the validator untouched, so the error names what the caller actually
wrote, with the keyword and params that rejected it. `maxRetries: "many"` is an
error, not a `0`. And the constraint keywords run on the coerced value, so `"3"`
against `{ type: 'integer', minimum: 5 }` becomes `3` and *then* fails
`minimum` — an answer neither a strict parser nor a repairing one can give.

**The input is never modified.** `value` is the input itself when nothing needed
coercing, and otherwise a copy sharing everything the coercion did not touch, so
callers do not pay for the defensive clone an in-place coercer forces.

**More precise than Ajv, in the safe direction.** The table is Ajv's
`coerceTypes` minus the cells where Ajv guesses: no whitespace-to-zero
(`Number(" ")` is `0`), no `0x`/`Infinity` strings, no trailing-point numerals,
and nothing coerced to or from `null` — `null` is a JSON value in its own right
and usually means "not set". Every value this coerces, Ajv coerces to the same
value, which is pinned as a property over the whole table and structurally over
a fuzz: a migration off Ajv never changes a value, it turns some of Ajv's silent
repairs into errors instead. Leading zeros and exponents stay, both being
ordinary ways to write a number in a YAML file.

**Unions are coerced when the answer is forced.** At a position offering several
scalar types — an array-form `type`, or a union of scalar branches — the value is
coerced only if exactly one of them can take it, so `string | { … }` turns `7`
into `"7"` while `number | string` leaves `true` alone and lets the validator
say what is wrong with it. A value that is already one of the offered types is
left alone. Ajv instead walks its own coercion list in order, which makes `"1"` a
number under `["number", "string"]` and a string under `["string", "number"]`;
the answer should not depend on the order the union was written in.
