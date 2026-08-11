---
'@amritk/runtime-validators': minor
---

**Behavior change:** an inherited property no longer counts as present. A value
built over a prototype — `Object.create(defaults)`, or a class instance —
previously satisfied `required` and had its inherited keys validated against
`properties`; it no longer does, which is what the own-key sweeps
(`minProperties`, `additionalProperties`, `unevaluatedProperties`) always
believed. JSON-derived values, which is what a JSON Schema validator normally
sees, are unaffected.

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

**Every schema keyword is read as an own property.** Schemas arrive at runtime,
and a bare `s['additionalProperties']` or `'propertyNames' in s` answers from
`Object.prototype` when a dependency has polluted it — so a single polluted
name turned a keyword on for every schema in the process:
`additionalProperties: false` rejected every object with an extra key,
`propertyNames` rejected every key, `minimum: 999` rejected every number. All
44 keyword reads now go through one own-property helper, and
`prototype-pollution.test.ts` enumerates the whole surface — 41 keywords,
polluted one at a time — so the next one cannot be found one review at a time
the way these were.

An unrecognized `format` is ignored, as the spec says. The checks table was
indexed directly, so `format: "toString"` found a `Function.prototype` method —
truthy, with no `.test` — and threw a `TypeError` on a schema it should simply
have accepted.

The limits walker gained the same schema-node-versus-name-map distinction: a
definition named `default` was skipped outright, so an `$id` under it never
registered and a `pattern` under it was never screened — a
catastrophic-backtracking regex compiled and ran with no `allowUnsafePatterns`
opt-in.
