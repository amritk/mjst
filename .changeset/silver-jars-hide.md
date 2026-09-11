---
'@amritk/runtime-validators': minor
'@amritk/generate-validators': minor
'@amritk/api': patch
---

Give every validation error its keyword and that keyword's own values.

An error was `{ message, path }` and nothing else, which makes it printable and
little more: a caller could not ask whether a failure was a missing field or a
malformed one without matching on English text, could not translate a message,
and could not rebuild one in their own domain's language.

Every error now also carries `keyword` — the JSON Schema keyword that rejected
the value — and `params`, that keyword's own values as far as they explain the
failure: `{ limit }` for a bound, `{ missingProperty }` for `required`,
`{ additionalProperty }` for an undeclared key, `{ allowedValues }` for an
`enum`. Both are always present, so neither needs guarding, and the names follow
Ajv's so an existing error-rendering table works unchanged.

Generated validators emit the same fields, so an error from a generated validator
and one from the interpreter can be handled by the same code. All of it lands on
the cold path: the `isX` guard and the hot half of `validateX` never build an
error object.
