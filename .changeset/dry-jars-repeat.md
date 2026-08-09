---
'@amritk/helpers': patch
---

Rewrite `#/definitions/...` refs written *outside* the `definitions` block when
upgrading a draft-07 document.

`upgradeDraft07Schema` renames the root `definitions` to `$defs`, and rewrote the
`$ref`s written inside that block to match — but the rest of the document was
spread through verbatim, so an ordinary
`{"properties": {"a": {"$ref": "#/definitions/thing"}}}` kept naming a block that
no longer exists. Generation then stopped with `Could not resolve $ref
"#/definitions/thing"`, which made a common shape of draft-07 document
ungeneratable. The same rename now applies to the whole document.

Only the `$ref` strings are rewritten; a key spelled `definitions` outside the
root block is left alone, since it is not hoisted and is not addressable as
`#/$defs/...`. A pointer that dives through a *nested* definitions block
(`#/definitions/x/definitions/y`) still keeps its inner segment and does not
resolve — unchanged, and the same limitation the in-block rewrite already had.

Fixes generation for draft-07 documents in `@amritk/generate-parsers`,
`@amritk/generate-validators` and `@amritk/generate-examples`, which all reach
this through `@amritk/helpers/walk-ref-graph`.
