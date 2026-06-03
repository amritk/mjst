---
"@amritk/runtime-validators": minor
---

Add `assert(schema, options?)`, a validate-or-throw helper that returns the input typed to the schema or throws a `ValidationFailedError` carrying the collected errors. Exposes the `Asserter` and `ValidationFailedError` types alongside it.
