---
'@amritk/generate-parsers': patch
---

Refuse a root type name that is not a TypeScript identifier.

`buildSchema` uses the name twice, verbatim: as `export type <name>` in the
emitted source, and — lowercased — as the `filename` of the returned
`GeneratedFile`. Since the documented contract is that the caller writes those
files itself, a name derived from the document being generated (an OpenAPI
`title`, say) was schema-controlled text reaching both: `x` + a backtick lands
inside the template literals the parsers throw with, and `'../../escaped'`
returned `{ filename: '../../escaped.ts' }`, which writes outside the output
directory.

The `mjst` CLI already refused `--root-type` for exactly these two reasons. The
check now lives where the name becomes a path, so every consumer of the library
inherits it rather than only the one that ships a CLI. Every identifier is still
accepted, including the non-ASCII ones `$ref` naming produces.
