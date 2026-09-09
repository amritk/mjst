---
'@amritk/generate-parsers': minor
---

Coerce booleans from a token table instead of `Boolean(x)`

A coercing parser repaired `type: 'boolean'` with `Boolean(x)`, which is a
JavaScript truthiness test rather than a reading of the value. Every non-empty
string is truthy, so `"false"`, `"no"`, `"off"` and `"0"` — every conventional
way of writing *off* — parsed as `true`, silently enabling whatever the flag
guarded. `2` and `{}` parsed as `true` just as confidently. This is the headline
case for env-var-style configuration, which is exactly the input a coercing
parser is handed.

The coercion is now a table, applied to the value trimmed and case-folded:

- `true`, `yes`, `y`, `on`, `1` and the number `1` → `true`
- `false`, `no`, `n`, `off`, `0`, `""` and the number `0` → `false`
- anything else → the schema's `default` (`false` when none is declared)

The last rule is what the other scalars already do: a value that does not denote
a boolean is not repaired into a guess. `Number("abc")` is `NaN` and falls back
to the default for the same reason.

**Behaviour change:** any generated parser for a boolean property returns a
different value for the inputs above. A document that said `"false"` and was
parsed as `true` now parses as `false`, and a value with no boolean reading
(`2`, `"maybe"`, an object, `null`) now takes the declared default instead of
`true`. Values that were already booleans are untouched and still take the
fast path — the table only runs where `Boolean(x)` used to.

This is wider than Ajv's `coerceTypes`, which accepts `"true"` / `"false"`, the
numbers `1` / `0` and `null`, and rejects the rest. A coercing parser cannot
reject, so the choice was between a default and a wrong answer.
