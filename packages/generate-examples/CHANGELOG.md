# @amritk/generate-examples

## 0.4.0

### Minor Changes

- 1b09827: Derive example values that actually satisfy more of their schema. `deriveExample`
  previously ignored many constraints and emitted values that fail their own
  schema; a new Ajv differential test now guards against that. It now honors:

  - numeric `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, and `multipleOf`
    (not just `minimum`), picking a value inside the bounds.
  - array `maxItems` (the count is clamped into `[minItems, maxItems]`, so
    `maxItems: 0` yields `[]`) and tuple schemas (`prefixItems`, and the draft-07
    array-form `items`), deriving one value per position.
  - object `required` keys that have no `properties` entry (filled from
    `additionalProperties` when it is a schema, else `null`).
  - `allOf`, by merging the branches (properties combined, `required` unioned,
    numeric/length bounds tightened) instead of returning `null`.
  - `enum` (and `const`) members alongside a length/range constraint — the first
    member that also satisfies it is chosen rather than blindly the first.
  - `minProperties` (filler keys are synthesized when extras are allowed),
    `uniqueItems` (primitive items are perturbed to stay distinct), `contains` /
    `minContains` (enough items satisfy the contained schema), and `pattern` via a
    best-effort regex sampler that does a small recursive descent over the pattern
    — anchors, character classes, `\d`/`\w`/`\s`, groups (capturing /
    non-capturing / named), alternation (`a|b`), and quantifiers — verified against
    the real regex before use.

  Lookarounds, backreferences, and otherwise unsatisfiable schemas remain
  best-effort; use the generated `fast-check` arbitrary when full fidelity is
  required.

## 0.3.2

### Patch Changes

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.3.0

### Minor Changes

- 4431f2d: Generate dedicated fast-check arbitraries and concrete examples for more string
  formats (`time`, `hostname`, `ipv4`, `ipv6`) and for multi-type schemas such as
  `type: ['string', 'null']`, instead of degrading them to `fc.anything()` / `null`.

## 0.2.2

### Patch Changes

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.2.1

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.2.0

### Minor Changes

- 6fdb8bf: Consolidate the `$ref`-graph traversal that the parser, validator, and example
  generators each re-implemented into a single shared `@amritk/helpers/walk-ref-graph`
  walker (plus `@amritk/helpers/generate-index-barrel` and
  `@amritk/helpers/extract-dynamic-anchor-defs`). The walker resolves the ref
  once and rewrites `$dynamicRef` → `$ref` in one place, and memoizes the
  draft-07 upgrade, dynamic-ref map, and each `resolveRef` / `extractRefs` per
  root document so running several generators over the same loaded schema does
  the expensive walking once.

  The validator and example generators now also seed `$dynamicAnchor`-only
  definitions (the parser generator already did), so a definition reachable only
  through `$dynamicRef` always gets its own generated file instead of being
  referenced without one.

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0

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
