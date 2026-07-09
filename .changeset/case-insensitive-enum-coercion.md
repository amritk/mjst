---
"@amritk/generate-parsers": minor
"@amritk/mjst": minor
---

Add a `caseInsensitive` option for case-insensitive `enum`/`const` coercion.

When enabled, a coercing parser normalizes a mis-cased string to the exact casing of the declared `enum`/`const` member it matches case-insensitively (e.g. `hElLo` → `hello`) instead of coercing it to the default. It applies to object properties, array items, and top-level enum/const parsers. Coerce mode only — strict parsers still reject a casing mismatch.

Performance is unaffected on already-valid input: the exact `===` fast path (and the shape validators / deep guards built on it) is unchanged, and the case-insensitive lookup is emitted only on the coercion failure branch, so a correctly-cased value never runs it.

`buildSchema` takes a new trailing `caseInsensitive` argument; `mjst` exposes it as the `--case-insensitive` flag and the `caseInsensitive` config key.
