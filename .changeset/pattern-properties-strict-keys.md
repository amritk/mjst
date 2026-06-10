---
'@amritk/generate-parsers': minor
'@amritk/generate-validators': minor
---

`additionalProperties: false` now respects `patternProperties` in both
generators, matching the runtime interpreter: a key that matches any declared
pattern is no longer treated as an undeclared key.

- **Validators.** The unknown-key sweep exempts pattern-matched keys. The
  patterns are compiled once at module scope (the same regex caching the
  interpreter does) and a key survives the sweep if it is in the known-keys Set
  or matches any pattern.
- **Parsers.** Schemas with `patternProperties` plus `additionalProperties:
  false` previously kept every key via a blanket `...input` spread. The parser
  now builds a selective copy: declared properties and pattern-matched keys are
  kept (the first `$ref` pattern is still coerced through its imported parser),
  and keys matching neither are rejected in strict mode (`unknown property
  "key"`) or stripped in coerce mode. This applies to both the combined
  (properties + patternProperties) and pattern-only parsers.

The remaining scope edge is composition: schemas combining
`additionalProperties: false` with `allOf`/`anyOf`/`oneOf` still skip the
undeclared-key handling, since per JSON Schema `additionalProperties` does not
see properties introduced by those branches and resolving them correctly is
`unevaluatedProperties`-shaped work.
