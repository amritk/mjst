---
"@amritk/runtime-validators": minor
---

Add `assert(schema, value, options?)`, a one-shot validate-or-throw helper that returns the value typed to the schema or throws a `ValidationFailedError` carrying the collected errors. Exposes the `ValidationFailedError` type alongside it.
