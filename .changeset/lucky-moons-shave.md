---
'@amritk/generate-validators': patch
---

Refuse a definition named after the runtime contract, and keep a control
character in a property name out of the emitted source.

A `$defs` entry whose type name comes out as `ValidationError` (written that way,
or as `validation-error`, or `validation_error`) emitted a file importing that
name twice — once from `validation-result.ts`, which every generated file imports,
and once from its own module. That is a `TS2300` for anyone building the output
and a duplicate binding Node ESM never loads past. Generation now refuses, the way
it already refuses a definition that wants the `validation-result.ts` filename; a
`typeSuffix` that moves the name clear still generates.

Error-path segments are escaped the way JSON escapes a string, so a property name
holding a control character survives into the emitted template literal. A raw
carriage return did not: a template normalises `<CR>` to `<LF>`, so the error for
a `"foo\rbar"` property pointed at `"foo\nbar"` — a different property, and one
the same document is free to declare beside it.
