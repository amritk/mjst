# @amritk/generate-examples

## 0.1.1

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.1.0

### Minor Changes

- 7e2b40a: Add `@amritk/generate-examples`: a generator that turns a JSON Schema into test
  data. For each schema node it emits a `fast-check` arbitrary (`FooArbitrary`)
  for property-based testing and a concrete, self-contained example value
  (`fooExample`) for fixtures, seeds, and docs, alongside the matching type
  definition. `fast-check` is an optional peer dependency used only by the
  generated arbitraries.
