---
'@amritk/generate-markdown': minor
---

The prose reference labels a map-shaped object as `Record<string, T>`.

A property whose values are described through `additionalProperties` or
`patternProperties` rather than named fields — `environments`, `resources`,
every other keyed bag — rendered its **Type:** as a bare `object`. That said
nothing about the values, and for a map of objects it left the value's fields
(`### methods`) reading as the map's own, when they live at
`resources.<name>.methods`; nothing on the page said the key level existed.

`referenceType` now spells the map the way it already spells an array: `Record<
string, string>` for a map of strings, `Record<string, object>` for a map of
objects, and `Record<string, ResourceConfig>` when the value shape carries an
`x-doc.type`. Several `patternProperties` shapes union (`Record<string, string |
number>`), and map-ness is read without a declared `type: 'object'` too. An
object that names `properties` beside its extras is still `object` — its rows
document the fields — and so is a value shape with no label of its own
(`additionalProperties: {}`), rather than `Record<string, unknown>`.

`x-doc.type` still overrides the label wholesale. Golden fixtures regenerated;
the only change is the **Type:** line of each map-shaped property.
