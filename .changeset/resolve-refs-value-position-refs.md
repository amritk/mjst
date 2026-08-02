---
'@amritk/resolve-refs': patch
---

Stop inlining a `$ref`-shaped object that is data, not a reference

`{ "$defs": { "a_string": { "type": "string" } }, "enum": [ { "$ref": "#/$defs/a_string" } ] }`
references nothing. `enum` holds *instances*, and one of them happens to be an
object with a `$ref` key — but the walk was purely structural, so it inlined that
object and turned "the enum containing `{"$ref": …}`" into "the enum containing
`{"type": "string"}`", changing what the document matches in both directions. The
official suite carries the case under exactly that name: *"naive replacement of
`$ref` with its destination is not correct"*.

Every structural walk in the package now carries the **role** of the node it is
at — a schema, a map of author-chosen names to schemas, instance data, or
something outside the vocabulary. `enum` / `const` / `default` / `examples` hand
their subtree back untouched; `properties` / `patternProperties` / `$defs` /
`definitions` / `dependentSchemas` / `dependencies` suppress keyword reading one
level down, so a definition legitimately *named* `enum` is still a definition and
a property named `$ref` is still a property — the trap in the naive version of
this fix, which the resource registry had; and an unrecognized keyword yields
`unknown`, which is absorbing, so OpenAPI's `components`/`paths` and `x-` vendor
blocks are walked exactly as before.

Two consequences beyond the inlining itself: the resource registry no longer
registers an `$id`/`$anchor` that is part of a value or a property name, and
`resolveRefsFromFile` no longer reads a file or opens a network connection for a
`$ref` string sitting inside an `enum`.

This takes the package to **107 / 107** on the `$ref` corpus of the official JSON
Schema Test Suite, with an empty expected-failure list.
