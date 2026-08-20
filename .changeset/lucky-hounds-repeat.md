---
'@amritk/generate-examples': minor
---

Fix several ways a generated example file could fail to compile, and bound the
generator's work on hostile schemas.

- A `$ref` inside `contains` or `dependentSchemas` was emitted as a bare
  `FooArbitrary` identifier with no matching import, so the generated file did
  not compile. The import collector now walks both surfaces.
- An example carrying a key its generated type never declares — `required`
  naming something absent from `properties`, a `dependentRequired` /
  `dependentSchemas` dependency, a `minProperties` filler on an object with no
  index signature — was an excess property TypeScript rejected. The key stays
  (dropping it would ship a fixture missing what its schema demands) and the
  literal is now emitted as `… as Foo`.
- An integer `multipleOf` was enforced with `.filter((n) => n % m === 0)`, which
  starved fast-check for anything but the smallest steps and rejected *every*
  value when `m` was `0` (`n % 0` is `NaN`). Positive integral steps are now
  derived analytically, as the `number` path already did; a non-positive one is
  dropped.
- A crossed range (`minLength: 10, maxLength: 2`, and the equivalents for
  numbers, arrays, and dictionaries) was emitted verbatim, and every bounded
  `fc.*` combinator asserts `min <= max` — so the generated module threw at
  import, taking its other exports with it. Crossed bounds now collapse.
- A large `minProperties` cost quadratic time and memory (synthesized key names
  grew with the key count), and a large `minLength`/`minItems` was honoured
  literally. Derived values are now capped at 10,000 characters / elements /
  keys, with the usual warning; the arbitrary still honours the real bound.
- The runtime-validator import was decided by searching the generated source for
  the validator's name, which a schema could plant in its own data — earning an
  import nothing uses, which a consumer's `noUnusedLocals` rejects.
