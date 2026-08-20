---
'@amritk/helpers': minor
---

`deriveRootTypeName` mangled non-ASCII titles. It split words on
`[^a-zA-Z0-9]+`, which is the ASCII-only class `ref-to-name` documents having
fixed for `$ref`-derived names — so a document titled `中文` or `Приложение`
reduced to nothing and was named `Document`, `Café Menu` came back as
`CafMenu` with the `é` deleted from the middle of a word, and `Ünïcödé Doc` as
`NCDDoc`. A `$ref` to a definition of the same name was spelled correctly, so
the root type and the refs into it disagreed. Both now go through one shared
`toPascalWords`, so they cannot drift again. Leading digits are still dropped
from a title (`3 amigos` → `Amigos`), which is where the two policies
legitimately differ.

`isDraft07Schema`, `hoistNestedDefs` and `deriveRootTypeName` also read
`$schema`, `$defs` and `title` straight off the object, so a polluted
`Object.prototype` was indistinguishable from a declared keyword — an inherited
`$schema` put every document through the draft-07 rewrite. All three now read
own properties only.
