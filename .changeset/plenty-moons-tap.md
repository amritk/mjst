---
'@amritk/helpers': patch
---

Make `foldNullable`'s data-keyword skip position-aware, and reverse the whole
pointer escape when reading names back.

Skipping `enum`/`const`/`default`/`examples` by key name also skipped any
property, `$defs` entry or dependency *named* one of them. The type generator
still widened that property with `| null` (the `nullable` key is deliberately
kept for exactly that), so the generated parser rejected a null the emitted
type declares valid. The walk now distinguishes a schema node from a
name-to-schema map, as the sibling walkers do.

`pruneExternalSchemas`' `unescapeSegment` reversed only RFC 6901's `~0`/`~1`,
but the pointers it reads are built by `escapePointerSegment`, which also
escapes `%` because the result travels as a URI fragment. A registered document
named `https://example.com/a%20b.json` therefore read back as `…a%2520b.json`,
matched no external name, and the companion schema a `$dynamicRef` still bound
to was pruned away. `readKey` also moves to its own file, per the
one-function-per-file rule.
