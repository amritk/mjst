---
"@amritk/helpers": minor
---

`buildDynamicRefMap` and `extractDynamicAnchorDefs` now scan the whole schema
document instead of only direct `$defs` entries, so a `$dynamicAnchor` declared
anywhere in the tree gets its `$dynamicRef`s rewritten and its target file
generated. Previously those bindings were silently lost. Anchor names map to
the JSON Pointer of the declaring subschema (first occurrence wins); a
`$dynamicAnchor` on the document root itself is still skipped, since a
`$ref: "#"` self-reference has no generatable output file.
