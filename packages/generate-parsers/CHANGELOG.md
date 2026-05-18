# @amritk/generate-parsers

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.
- b6e63c3: Add `strict` option that makes generated parsers throw on invalid input instead of coercing to defaults. Available as the `--strict` CLI flag, the `strict` key in `mjst.config.json`, and the `strict` argument on `buildSchema` / `generateFile` / `generateParserFunction`. Throws on non-object input, missing required properties, wrong primitive types, and enum / pattern / length / min / max / multipleOf violations. Unknown extra keys are still allowed.

### Patch Changes

- ad1efe5: chore: initial release
- Updated dependencies [ad1efe5]
- Updated dependencies [53fa6bf]
  - @amritk/generate-markdown@0.2.0
  - @amritk/helpers@0.2.0
