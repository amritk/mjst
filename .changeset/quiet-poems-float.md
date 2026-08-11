---
'@amritk/helpers': patch
---

Apply the `assignKey` guard to the rest of the draft-07 upgrade, and share the
keyword sets.

`upgradeDraft07Schema` introduced `assignKey` but still rebuilt the root
`definitions` map — and all four of `hoistNestedDefs`' outputs — with plain
assignments. A definition named `__proto__` therefore set the map's prototype
and vanished, while the `$ref` to it was still rewritten to `#/$defs/__proto__`
— a pointer that now resolves to nothing, so the generators fail on a document
that declares the definition right there. The short-name alias step also tested
membership with `in`, so an alias of `constructor` or `toString` was silently
skipped.

`SCHEMA_MAPS` joins `DATA_KEYWORDS` as a shared export, replacing the identical
copies that had appeared in `foldNullable` and in `@amritk/adapters`; the anchor
and dynamic-ref map builders drop their private restatements of `DATA_KEYWORDS`
for the same reason the duplicated pointer escaper went.
