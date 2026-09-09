---
'@amritk/generate-parsers': minor
---

Enforce union `items` that reach a recursive `$ref`, and stop stubbing scalar definitions

A strict parser promises to throw on every document its schema rejects. Measured
against Ajv over the published Scalar configuration schema
(`https://cdn.scalar.com/schema/scalar-config.json`), it accepted **771 of 4000**
mutated documents that Ajv rejects. It now agrees on all 4000.

Every one of those traced to a single chain, fixed here end to end:

- **Scalar definitions generated a `=> false` stub shape validator.** Any `$defs`
  entry with neither `properties` nor union branches — `{ type: 'string' }`
  included — fell through to the conservative stub. A stub is not merely a missed
  optimization: it reports a *valid* value as out of shape, so a `$ref` to a plain
  string made its whole parent untrustworthy. These now emit the real predicate,
  constraints and all (`pattern`, code-point length bounds, numeric bounds,
  `multipleOf`), which is exact in both directions.
- **The false-soundness trust walk mirrored that stub**, distrusting the same
  definitions and propagating the distrust up through every enclosing union.
- **With the union distrusted, an array's `items` were checked by nothing but
  `Array.isArray`.** The inline subschema matcher refuses a union whose branch
  reaches a *cyclic* `$ref`, because proving it inline would mean unrolling the
  cycle — and the strict item check had no fallback for that. It now falls back to
  the union *membership* check, which inlines nothing: a `$ref` branch becomes a
  call to that definition's generated `validate…Shape`, and a recursive
  definition's validator calls itself, so the recursion bottoms out on the data.

Two coercion fixes came with it, both in service of the standing contract that a
coercing parser's output is a valid instance of its own schema:

- **A `$ref`-d constrained scalar is now coerced against its constraints.** The
  root scalar parser was a flat `typeof` test with a literal fallback, so
  `"Bad Slug"` was handed back unrepaired against a `pattern`, and the `""` it
  fell back to was itself invalid under `minLength: 1`.
- **A pattern-derived default is now verified against its own pattern.** The
  previous defaults were unverified substring guesses, and several did not match:
  `^\+?\d{3}\d{4}$` was answered with `"+1234567890"`, three digits too many.
  Defaults are now synthesized by reading the pattern, checked against it (and
  against any length bounds) before being used, and omitted when nothing verifies.

One boundary is documented rather than changed: a coercing parser still passes an
array element matching no branch of a union through unrepaired, because choosing a
branch to coerce toward would discard information for a non-discriminated union.
Ajv's `coerceTypes` rejects those documents rather than repairing them. Use a
strict parser when you need the verdict.
