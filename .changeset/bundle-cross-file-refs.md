---
"@amritk/resolve-refs": minor
"@amritk/mjst": minor
---

`resolveRefsFromFile` takes a `bundle` option: each `$ref` target in another document is hoisted into the root's `$defs` once and its refs point there, a ref into the root is kept as written, and a ref that points inside another document's definition hoists that whole definition and points into it. The output is one document whose refs are all internal `#...` pointers — a ref that names an embedded resource of the root by its `$id` URI is rewritten to that resource's pointer too, so nothing in the output reads as a ref to another document. A target in a document that declares an `$id` is still inlined, since moving it would change what its `#/...` pointers name.

`mjst` now bundles a schema with cross-file or remote `$ref`s instead of inlining it, so the generated code changes for those schemas: each shared definition is one named type file, as it is when the same definitions sit in one file, where before every use of a shared schema — internal refs included, once any `$ref` crossed a file — was emitted as its own inline copy. On schemas whose definitions reference each other in layers that was exponential: a 104-definition schema split into two files generated 143 MB in 22 s and now generates 613 KB in 0.2 s, identical to the single-file output. Schemas whose refs all stay in one document are unaffected.
