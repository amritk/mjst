---
'@amritk/generate-validators': patch
---

Emit no symbol the generated file never reads, so the output compiles clean under
`noUnusedLocals` / `noUnusedParameters` — the flags this repo holds itself to and
any consumer inheriting them.

A `$ref`'s import carries the type, the validator, or both, decided from the text
that was emitted: a ref in a position the type generator does not read (an `if`
arm, whose whole node it types `unknown`) is called and never named, and one in a
position only the type reads (a tuple's rest taken from `additionalItems`) is
named and never called. A `contains` whose match is decidable (`contains: true` /
`contains: false`) needs no loop at all, so it no longer binds an element nothing
looks at, and the `_item0` / `_root` bindings are emitted only where a check reads
them.

The compile suite now runs every case under those flags rather than holding a
list of known gaps.
