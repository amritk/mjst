---
"@amritk/generate-examples": patch
"@amritk/generate-markdown": patch
"@amritk/adapters": patch
"@amritk/mjst": patch
---

Robustness fixes across the CLI and peripheral generators:

- **generate-examples**: recursive schemas now emit lazily-tied fast-check
  arbitraries (`fc.letrec`) instead of code that crashed with a TDZ
  `ReferenceError`; `pattern`s are escaped so a `/` no longer breaks the emitted
  regex literal, and `minLength`/`maxLength` are honored alongside a pattern;
  tuples, `allOf`, `additionalProperties`, and combined `minimum`+`exclusiveMinimum`
  bounds are handled.
- **cli**: config files no longer silently drop the `helpers`/`typeSuffix`/`banner`
  keys; unknown or value-missing flags now error instead of being ignored; schema
  discovery skips `node_modules` and dot-directories; a missing `npx`/`tsc` is
  distinguished from a real compile failure.
- **generate-markdown**: `x-icon` is HTML-escaped, and a README missing its
  markers is no longer clobbered with a table-only file.
- **exports** maps now order the `types` condition before `default` so type
  resolution works.
