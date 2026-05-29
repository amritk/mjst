---
'@amritk/generate-examples': minor
---

Add `@amritk/generate-examples`: a generator that turns a JSON Schema into test
data. For each schema node it emits a `fast-check` arbitrary (`FooArbitrary`)
for property-based testing and a concrete, self-contained example value
(`fooExample`) for fixtures, seeds, and docs, alongside the matching type
definition. `fast-check` is an optional peer dependency used only by the
generated arbitraries.
