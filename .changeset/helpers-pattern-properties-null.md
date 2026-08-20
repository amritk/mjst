---
'@amritk/helpers': patch
---

Treat a non-map `properties` / `patternProperties` as absent instead of crashing.

`typeof null === 'object'`, so a document carrying `{"patternProperties": null}`
slipped past the `!== undefined` check and reached `Object.keys(null)` — which
throws a `TypeError` and took the whole generation run down with it, rather than
producing a type for the one bad schema. Schemas come from the caller and
malformed ones are ordinary input, so a keyword whose value is not a map of
names to schemas is now read as absent. The same applies to a `null`
`additionalProperties`, which previously counted as present and was rendered as
an index signature's value type.
