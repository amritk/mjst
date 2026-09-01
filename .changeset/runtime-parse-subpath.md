---
'@amritk/runtime-validators': minor
'@amritk/api': patch
---

Add `@amritk/runtime-validators/parse` — a runtime parser to sit beside the
runtime validator.

`validate` is the right tool for data that arrived as JSON. This is for data
that did not: an HTTP query string, a path segment, a header, a form body, an
environment variable, a CSV row. All of those deliver every scalar as a string,
so a schema saying `{ type: 'integer' }` and an input saying `'42'` are
describing the same thing, and only a parser can say so.

`parse(schema)` coerces its input toward the schema, then validates the result,
returning `{ ok: true, value } | { ok: false, errors }`. Coercion never decides a
verdict — it converts and defers, so a parse can only ever accept something
`validate` would have accepted, and a string that does not actually denote its
declared type is passed through unchanged to be rejected with a proper type
error rather than guessed at. It applies only where a subschema names a single
scalar `type`: a `type: ['number','string']`, `anyOf`, `oneOf` or `if` leaves the
target ambiguous, and `'42'` is a legitimate value under the string branch of
each. Absent object properties are filled from their `default`, deep-copied so a
caller mutating the result cannot corrupt a schema held as a constant. Input is
never mutated, and a value that already has the declared types is returned by
identity.

The string-to-scalar table is exported as `coerceScalar` and is now the
monorepo's only copy of those rules. `@amritk/api` imports it instead of
restating it: its request pipeline fuses coercion into building the
params/query/headers object straight from the transport, so it cannot call
`parse` itself, but each of the table's guards — blank strings, the non-finite
`'Infinity'` that would otherwise serialize back out as JSON `null` — was
written there after a bug, and a second copy would have to learn each one again.
No behavior change to `@amritk/api`.
