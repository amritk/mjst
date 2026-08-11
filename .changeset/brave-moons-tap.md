---
'@amritk/helpers': patch
---

Stop the schema walkers from dropping a property named `__proto__`, and make
every pointer escaper agree with the decoder.

A JSON Schema may describe a property called `__proto__`, and every walker here
rebuilds objects key by key with `result[key] = …`. On that one key that is not
an assignment — it runs the prototype setter, so the property never reaches the
output (a declared property and all its constraints, silently gone) and the
rebuilt object starts inheriting the subschema's keys instead, which a later
`node.$ref` or `node.type` then reads. The guard existed in exactly one place
(`rewriteDefinitionsRefs`); it is now a shared `assignKey` used by
`upgradeDraft07Schema`'s two walkers, `normalizeRefScopes`, `foldNullable`, and
the three rebuilds in `walkRefGraph`. `foldNullable` also swept with `for…in`,
which walks the prototype chain, and now iterates own keys.

Three lookups indexed a map keyed by author-chosen names, which answers
`__proto__`, `constructor` and `toString` from `Object.prototype`.
`resolveRef('__proto__', …)` returned `Object.prototype` as though the document
had declared that definition — and `walkRefGraph` emitted a file for it.
`$dynamicRef: "toString"` resolved to a `Function` and was written into `$ref`
in place of the "Unresolvable $dynamicRef" error the case is meant to produce.

`buildAnchorMap` and `buildDynamicRefMap` each carried a private pointer
escaper that handled `~` and `/` but not `%`, while the pointers they produce
are handed back as `$ref` fragments that `resolveRef` percent-decodes. A
definition named `a%2Fb` was therefore looked up as `a/b`, leaving any `$anchor`
under it unresolvable. Both now use the registry's `escapePointerSegment`, the
function that contract is actually defined by.
