---
'@amritk/generate-parsers': patch
---

Make a coercing parser's repair an instance of the schema it repaired against.

A coercing parser exists to hand back a valid value, and in six cases it handed
back one the schema still rejects. Found by a new differential fuzz that asks Ajv
one question the strict fuzzers cannot: is the parser's *output* valid?

The type-based fallbacks ignored the constraints of the very schema they were
defaulting for. `{ type: 'string', minLength: 1 }` fell back to `""`, and
`{ type: 'integer', minimum: 1 }` to `0`. A string fallback is now padded to
`minLength` (capped, so a pathological bound cannot inline a huge literal, and a
`pattern` keeps its own guess), and a numeric one is moved inside `minimum` /
`maximum` / `exclusiveMinimum` / `exclusiveMaximum` and up to the next multiple
of `multipleOf` — verified against every bound before it is used, so an
unsatisfiable combination still falls back to `0`.

The coercions had the same gap: `String(x)` cleared `type: 'string'` but not the
schema's `pattern` or length bounds, so a missing value was "repaired" into `""`
and an object into `"[object Object]"`; `Number(x)` cleared `Number.isInteger`
but not `minimum`. Both now keep the converted value only when it satisfies the
schema, and fall back to the default otherwise. An `array` coercion produced a
bare `[]`, ignoring `minItems`; it uses the schema's own fallback now.

An array of `const` items passed every element through untouched, so
`{ items: { const: null } }` left `["a"]` as it found it.

`minLength` / `maxLength` are counted in Unicode code points on every branch that
reads them — the coercion path, the fast-path guard, and the union-branch check —
matching the strict assertions and the subschema matcher, which already did. A
bare `.length` disagreed with them on any string carrying a surrogate pair, and
on the fast path that meant a value the strict assertions reject was waved
through as "already in shape".
