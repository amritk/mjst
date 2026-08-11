---
'@amritk/runtime-validators': patch
---

Answer "does the instance have this property?" one way.

The presence test was a `!== undefined` read with a precomputed exemption for
the standard `Object.prototype` names, and it kept being wrong in a new way:
an inherited value from `Object.create({ token: 'x' })`, then a polluted
`Object.prototype` carrying a name the exemption list does not know, then the
two call sites (`required` with no `properties` entry, and the dependency
keywords' `hasProperty`) that a narrower fix had missed. Each version
disagreed with `minProperties`, `additionalProperties` and
`unevaluatedProperties`, which sweep the instance's own keys — so an object
serializing to `{}` satisfied `required: ['token']` while every other keyword
agreed it had no properties at all.

`hasProperty` is now `Object.hasOwn(obj, key) && obj[key] !== undefined`, and
every keyword that asks the question calls it. It costs a call per *declared*
key — the schema's, not the instance's — against a class of bug that recurred
three times; the exemption list and its precomputed flag are gone with it.
