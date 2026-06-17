---
"@amritk/resolve-refs": patch
---

Preserve keywords sibling to a `$ref` when inlining. Per JSON Schema 2020-12 a
`$ref` does not suppress its sibling keywords — they apply alongside the
referenced schema — but the resolver replaced the whole node with the resolved
target, silently dropping constraints like `maxLength`, `minimum`, `enum`, or an
extra `required`. Siblings are now combined with the target in an `allOf` (so a
constraint present on both sides is never lost), while a `$ref` with no siblings
still inlines directly as before. The sibling-free target is what gets cached, so
each occurrence keeps its own siblings.

The same fix applies to the cross-file/remote resolver (`resolveRefsFromFile`),
which additionally now recurses into a `$ref` node's siblings during prefetch, so
a cross-file `$ref` that appears beside another `$ref` is loaded and inlined
instead of being missed.
