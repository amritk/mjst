---
"@amritk/yaml": patch
---

Fix two parser divergences from `yaml` (eemeli) surfaced by differential testing:

- An explicit `!!bool` tag on a quoted or block scalar now coerces to a boolean
  (`!!bool "true"` → `true`), matching how `!!int` / `!!str` / `!!null` already
  read tagged scalars.
- A bare `-` at the end of a line is now parsed as a sequence entry with an empty
  (null) value instead of being dropped, so trailing empty items are preserved
  (`- a\n-\n` → `['a', null]`).
