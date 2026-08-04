---
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
'@amritk/api': patch
---

Reject `NaN` against a numeric bound, matching `@amritk/runtime-validators`.

Bounds were emitted as their direct failure condition (`x < minimum`) rather than
the negated pass condition (`!(x >= minimum)`). The two agree on every ordinary
value and are opposite for `NaN`, which compares `false` against every operator:
the direct form read that as "not out of bounds" and let a `NaN` through
`minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, where the
interpreter and Ajv both reject it. Generated validators, strict generated
parsers, and the compiled API engine's inlined guards all now write the negated
form — so a `NaN` fails a bounded number everywhere in the toolchain. A bare
`{ type: 'number' }` with no constraint still accepts it, as Ajv does; only a
bound or `multipleOf` rejects it.

Two internal inconsistencies close with it: `@amritk/generate-parsers` emitted the
un-negated `x >= min` in its inline matchers and the direct `x < min` in its
strict assertions, so the same schema could answer differently depending on which
path ran, and `@amritk/api`'s compiled engine disagreed with its own runtime
engine for a value the two are documented to be observationally identical on.

`interpreter-parity.test.ts` now covers the numeric keywords — bounds, the
draft-04 boolean `exclusive*` form, and `multipleOf` across integer, fractional,
and quotient-overflowing divisors — over a value set built to separate the two
spellings (`NaN`, `±Infinity`, `1e308`, `1000000.005`). Nothing pinned these
before, which is how the drift got in.
