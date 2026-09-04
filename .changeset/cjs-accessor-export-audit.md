---
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
---

Document why generated code exports every runtime value as a plain `export const`
rather than an `export { … } from` re-export, and pin it with a test. Compiled to
CommonJS the two differ: a re-export (and every export of a bundler's CJS output)
becomes a getter on `module.exports`, which costs a call per invocation once a
second export from the same module has been hot in the same process. Both READMEs
gain a "Consuming generated code" note, and both packages gain a test asserting no
generated file carries a runtime re-export. No codegen changes.

The validators' `bench:moltar` now reproduces the leaderboard's process layout —
all four modes (parseSafe, parseStrict, assertLoose, assertStrict) in one process
per library, consuming a CommonJS entry through the module object — and carries
data-property vs getter entry builds as a control.
