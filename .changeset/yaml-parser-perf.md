---
"@amritk/yaml": minor
---

Squeeze more throughput out of the parser hot path and shrink the node tree.

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
