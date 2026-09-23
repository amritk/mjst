---
"@amritk/lint": patch
"@amritk/mjst": patch
---

Harden the YAML parser adapter and the YAML edit model.

- A mapping key built from nested aliases no longer hangs linting: the position index now renders keys with `@amritk/yaml`'s budgeted `keyText` instead of its own unbounded copy.
- A document whose projection exhausts its budget (an alias bomb in values, or excessive projection depth) is reported as an error diagnostic at the start of that document, with `undefined` data, instead of throwing out of `createDocument`, `lint`, and the CLI.
- Parser-level YAML diagnostics now carry the parser's stable `code` (e.g. `DUPLICATE_KEY`, `UNKNOWN_DIRECTIVE`). Lint findings still report `code: 'parser'`.
- Line numbers treat a lone CR and CR LF as one line break each (YAML 1.2 §5.4), so positions in CR-only files match the parser; JSON positions follow the same rule.
- Fixes now apply under a null key (`~: 1`), an alias key (`*k : 1`), and a collection key (`? [a, b]`): the edit model addresses keys by the same text `toJS` projects. A sequence index segment must now be canonical (`'1'`, not `'01'` or `' 1'`), otherwise the edit is a no-op.
