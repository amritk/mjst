---
"@amritk/yaml": patch
---

Fix two parser divergences from `yaml` (eemeli) surfaced by differential testing:

- An explicit `!!bool` tag on a quoted or block scalar now coerces to a boolean
  (`!!bool "true"` → `true`), matching how `!!int` / `!!str` / `!!null` already
  read tagged scalars.
- A bare `-` at the end of a line is now recognized as a sequence entry with an
  empty (null) value everywhere a sequence can start, not just mid-list. Trailing
  empty items are preserved (`- a\n-\n` → `['a', null]`) and a block sequence made
  entirely of bare dashes parses as a list (`a:\n  -\n  -\n` → `{ a: [null, null] }`)
  instead of collapsing into a plain scalar.
