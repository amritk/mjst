# @amritk/yaml

## 0.1.1

### Patch Changes

- 8395066: Fix multi-line flow-scalar folding, clarify the README, and broaden the
  differential tests.

  - Fix two bugs in single-/double-quoted multi-line scalar folding that produced
    the wrong string for documents like the GitHub OpenAPI spec: trailing
    whitespace on a scalar's final line was incorrectly stripped (it is literal
    content, since no line break follows), and a blank-line run reaching the
    closing quote emitted one newline too many. Output now matches `yaml` (eemeli)
    byte-for-byte on the full GitHub and DigitalOcean specs.
  - Replace the `[start, end)` interval notation in the README, which reads as a
    mismatched bracket pair, with plain wording that spells out the `start`
    (inclusive) and `end` (exclusive) offsets, and fix the `nodeAtPath` API row to
    say nodes carry `start`/`end` rather than a `range`.
  - Add the real-world DigitalOcean OpenAPI spec as a vendored fixture and
    regression cases for the folding fix. The fixture lives outside `src/`, so it
    is not shipped in the published package.

## 0.1.0

### Minor Changes

- 185c63b: Squeeze more throughput out of the parser hot path and shrink the node tree.

  Hot-path tuning (no API change): a precomputed first-character lookup table for
  plain-scalar resolution, eliminate a redundant `key:` colon scan when entering a
  block mapping, hoist quoted-key handling out of the colon scanner's per-character
  loop, and build `toJS` collections with index loops instead of a per-sequence
  `.map` closure.

  Smaller nodes (**breaking shape change**): each node and error now carries inline
  `start` / `end` number fields instead of a `range: [start, end]` (and error
  `pos`) tuple. This removes a second heap allocation per node — on a 100 KB OpenAPI
  document that is ~12k fewer arrays — cutting retained tree memory by ~35–45% and
  making the source-mapped parse ~9–19% faster (largest gains on small/medium docs).

  Migration: replace `node.range[0]` → `node.start`, `node.range[1]` → `node.end`,
  and `error.pos[0]` → `error.start`. The `Range` type export is removed. Node
  guards (`isMap`/`isScalar`/…) and `nodeAtPath` are unchanged.

- 84e3cda: Add `@amritk/yaml`: a tiny, dependency-free YAML parser with exact source
  positions, built for diagnostics. Every node records its `[start, end)` source
  range so a consumer can map any value back to an exact `line:column`. It parses
  to data via `parse`, to a positioned tree via `parseDocument`, resolves a JSON
  path to its node with `nodeAtPath`, and maps offsets to `line:column` with
  `lineCounter`. Covers block and flow collections, all quoting styles, block
  scalars with chomping, comments, anchors, aliases, and merge keys, with YAML 1.2
  core-schema scalar resolution. Benchmarked ~20× faster than `yaml` for building
  a source-mapped tree and ~7.6× smaller, with a differential test suite pinning
  data output to `yaml` across full OpenAPI specs.
