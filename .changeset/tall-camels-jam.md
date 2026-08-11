---
'@amritk/runtime-validators': patch
---

Stop reading the prototype chain when the schema and the value are runtime input.

An unrecognized `format` is ignored per spec, but the checks table was indexed
directly — so `format: "toString"` (or `constructor`, `valueOf`,
`hasOwnProperty`) found a `Function.prototype` method instead: truthy, with no
`.test`, so the validator threw a `TypeError` on a schema it should simply have
accepted. Only reachable with `formats: 'all'` or the format explicitly enabled,
which is exactly the configuration that trusts a runtime-supplied schema most.

`additionalProperties`, `patternProperties`, `propertyNames` and
`unevaluatedProperties` swept the instance with a bare `for…in`, which walks the
prototype chain, while `minProperties`/`maxProperties` count own keys — so the
same object got contradictory answers about which properties it has. An
inherited key was validated as though the instance carried it, and under a
polluted `Object.prototype` every object in the process gained a key that
`additionalProperties: false` then rejected. All four now iterate own keys, the
choice `minProperties` had already made and documented.
