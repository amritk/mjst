---
"@amritk/yaml": patch
---

Clarify the README's description of node source positions and broaden the
differential tests.

- Replace the `[start, end)` interval notation, which reads as a mismatched
  bracket pair, with plain wording that spells out the `start` (inclusive) and
  `end` (exclusive) offsets, and fix the `nodeAtPath` API row to say nodes carry
  `start`/`end` rather than a `range`.
- Add the real-world DigitalOcean OpenAPI spec as a vendored fixture and assert
  our data projection matches `yaml` (eemeli) on it. The fixture lives outside
  `src/`, so it is not shipped in the published package.
