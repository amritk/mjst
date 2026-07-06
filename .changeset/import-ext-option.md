---
'@amritk/mjst': minor
'@amritk/generate-parsers': minor
'@amritk/helpers': minor
---

Add `--import-ext <js|ts>` (config key `importExt`) to control the extension
emitted on relative import specifiers in generated output — cross-file `$ref`
imports, the `index.ts` barrel, and embedded `_helpers/` imports.

The default stays `js` (the standard TS NodeNext form, required by `--build`).
Passing `ts` emits the literal on-disk paths so the generated `.ts` sources run
directly under Node's type stripping (Node 22.6+ with
`--experimental-strip-types`, on by default from Node 23) with no compile step.
`--import-ext ts` is rejected in combination with `--build`, since tsc refuses
to emit from `.ts` specifiers.

`buildSchema` gains a trailing `importExt` parameter, and
`generateIndexBarrel` accepts an `importExt` option.
