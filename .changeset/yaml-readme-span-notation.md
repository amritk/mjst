---
"@amritk/yaml": patch
---

Clarify the README's description of node source positions. Replace the
`[start, end)` interval notation, which reads as a mismatched bracket pair, with
plain wording that spells out the `start` (inclusive) and `end` (exclusive)
offsets, and fix the `nodeAtPath` API row to say nodes carry `start`/`end`
rather than a `range`.
