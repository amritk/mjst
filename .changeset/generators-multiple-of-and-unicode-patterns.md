---
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
'@amritk/helpers': patch
---

Emit the interpreter's own `multipleOf` check, and compile `pattern` in Unicode
mode — closing the last two places where generated code and
`@amritk/runtime-validators` could disagree about a document.

`@amritk/helpers/multiple-of-check` claimed to mirror the interpreter and had
drifted from it. The interpreter splits on the divisor (an exact `%` when it is
an integer, a quotient within `2·ε·|q|` when it is not); the emitter still
divided in every case and allowed `1e-8·|q|` — roughly 10⁷× the actual
representation error. Generated validators and parsers therefore **accepted
values the interpreter rejects**: `1000000.005` against `multipleOf: 0.01` (a
half-cent past a whole dollar amount) passed, and so did any value whose quotient
overflows to `Infinity`, because the old fail expression asked `NaN > tolerance`
and got `false`. The emitter now produces the interpreter's two branches
verbatim, so both verdicts flip to invalid and the two implementations agree
again. `0.3` still satisfies `multipleOf: 0.1`, which is what the tolerance is
for.

A `pattern` now compiles with the `u` flag wherever the pattern admits one, the
same try-`u`-then-fall-back decision the interpreter makes at runtime, taken once
at generation time by the new `regexLiteral` / `regexFlagsFor` in
`@amritk/helpers/escape-regex-pattern`. Without the flag a Unicode property
escape is inert — `\p{Letter}` was read as a literal `p{Letter}` — and `^.$`
rejected a single astral character. Every emit site now goes through
`regexLiteral` rather than interpolating an escaped body into its own `/…/`, so
the flag decision is made in one place instead of at a dozen call sites.

Measured against the official JSON Schema Test Suite, this closes three cases in
each generator: `@amritk/generate-validators` moves to **1271 / 1281 (99.2%)**
and strict `@amritk/generate-parsers` to **1240 / 1281 (96.8%)**.
