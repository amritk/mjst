---
"@amritk/yaml": patch
---

Squeeze more throughput out of the parser hot path: a precomputed first-character
lookup table for plain-scalar resolution, eliminate a redundant `key:` colon scan
when entering a block mapping, hoist quoted-key handling out of the colon scanner's
per-character loop, and build `toJS` collections with index loops instead of a
per-sequence `.map` closure. Measures ~2–5% faster across the small/medium/large
fixtures (largest gain on scalar-heavy documents) for both the source-mapped tree
and plain-data paths, with no API change.
