---
"@amritk/mjst": minor
"@amritk/generate-parsers": minor
---

Add `strict` option that makes generated parsers throw on invalid input instead of coercing to defaults. Available as the `--strict` CLI flag, the `strict` key in `mjst.config.json`, and the `strict` argument on `buildSchema` / `generateFile` / `generateParserFunction`. Throws on non-object input, missing required properties, wrong primitive types, and enum / pattern / length / min / max / multipleOf violations. Unknown extra keys are still allowed.
