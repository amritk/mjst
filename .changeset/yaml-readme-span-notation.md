---
"@amritk/yaml": patch
---

Fix multi-line flow-scalar folding, clarify the README, and broaden the
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
