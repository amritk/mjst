---
'@amritk/parsers': minor
---

Close the parity gaps that stood between `@amritk/parsers` and retiring the two
generators it composes, and give generated validators an `importExt`.

Three options had no route through the facade — `importExt` and `logWarnings`
from the parser generator, and, underneath that, the validator generator had no
`importExt` at all: it hardcoded `.js` on every emitted specifier. That was
survivable while the CLI kept the two outputs in separate trees. It is not
survivable in one shared directory, which is what `@amritk/parsers` emits: asking
for `importExt: 'ts'` would have produced parser files saying `.ts` beside
validator files saying `.js`, a set that resolves under neither Node's type
stripping nor a compiled build. `buildValidatorSchema` now takes `importExt` as a
trailing argument (defaulting to `'js'`, so nothing existing moves) and threads it
through the per-file imports, the cross-`$ref` imports, the `formats.ts` import
and the barrel.

The parity itself is now a test rather than a claim. Every option of both
generators is exercised through the facade and through the direct call, and the
two file sets are compared by fingerprint — an option with no route through the
facade is a capability that would be lost when the packages go, and a route that
produces *different* bytes is worse than none, because it looks like it works.
Alongside it, two tests on the emitted specifiers: that one build uses one
extension throughout, and that every relative specifier resolves to a file the
same build actually emitted.
