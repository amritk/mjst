---
'@amritk/runtime-validators': patch
---

Answer "does the instance have this property?" one way, and stop reading
schemas off the prototype chain.

The presence test was a `!== undefined` read with an exemption list for the
standard `Object.prototype` names, and it disagreed with `minProperties`,
`additionalProperties` and `unevaluatedProperties`, which sweep the instance's
own keys: `Object.create({ token: 'x' })` — a value that serializes to `{}` —
satisfied `required: ['token']` while every other keyword agreed it had no
properties. `hasProperty` is now `Object.hasOwn(obj, key) && obj[key] !==
undefined`, and every keyword that asks the question calls it. The exemption
list is gone.

The four instance sweeps (`additionalProperties`, `patternProperties`,
`propertyNames`, `unevaluatedProperties`) iterate own keys, so an inherited key
is no longer validated as though the instance carried it — and a polluted
`Object.prototype` no longer makes `additionalProperties: false` reject every
object in the process.

An unrecognized `format` is ignored, as the spec says. The checks table was
indexed directly, so `format: "toString"` found a `Function.prototype` method —
truthy, with no `.test` — and threw a `TypeError` on a schema it should simply
have accepted.

The limits walker gained the same schema-node-versus-name-map distinction: a
definition named `default` was skipped outright, so an `$id` under it never
registered and a `pattern` under it was never screened — a
catastrophic-backtracking regex compiled and ran with no `allowUnsafePatterns`
opt-in.
