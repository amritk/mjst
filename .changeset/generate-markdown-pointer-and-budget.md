---
'@amritk/generate-markdown': patch
---

Resolve `$ref` pointers the way the rest of the repo does, and stop an
exponential inline from running forever.

`resolvePointer` refused to index an array, so `#/$defs/timeout/anyOf/0` — an
ordinary pointer real schemas write — silently produced a property documented as
a bare name with no type and no description. Segments are now percent-decoded
(`#/$defs/a%20b` addresses the definition named `a b`), array positions resolve,
and only *own* properties are addressable, so `#/constructor` no longer reads
through `Object.prototype`.

Inlining is a tree expansion: a definition reused twice at each of D nesting
levels expands to 2^D nodes, so a 3 KB schema nested 22 deep never finished and
one nested 16 deep quietly wrote a 29 MB README. The walk now stops at 100,000
inlined nodes and says why — three orders of magnitude above any real config
schema.

The **Required** column also counted a `required` entry naming a property the
schema does not declare, rendering a column that stayed blank on every row; it
now counts only names `properties` actually has. Every walk over `properties`
goes through one guard, so a malformed `properties: "ab"` no longer spells its
characters into rows named `0` and `1`. A malformed `config.schema.json` reports
its path instead of a bare parse offset.
