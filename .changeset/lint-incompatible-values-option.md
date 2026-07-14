---
"@amritk/lint": patch
---

feat: implement the `incompatibleValues` parser option. It was accepted on
`IParserOptions` (and threaded through `parserOptions.incompatibleValues` in the
ruleset) but `parseYaml` never read it, so callers who configured it got a silent
no-op. The core schema projects `.nan`/`.inf`/`-.inf` to the non-finite numbers
`NaN`, `Infinity`, and `-Infinity`, which `JSON.stringify` silently rewrites to
`null`; each such value is now reported at the configured severity with an
`INCOMPATIBLE_VALUE` code, its range pointing at the offending value. Detection
is opt-in: `undefined`, `false`, and `"off"` leave it disabled.
