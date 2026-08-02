---
'@amritk/runtime-validators': minor
---

`validateGuard` stops narrowing where the inferred type cannot describe every
accepted value

`FromSchema` infers an object shape from applicator keywords alone, so
`{ properties: { a: { type: 'string' } } }` infers `{ a?: string }`. The
interpreter — correctly — accepts a non-object against that schema, because JSON
Schema's object keywords ignore values that are not objects. The guard was
therefore handing back `input is { a?: string }` for a `42` it had just approved.

For exactly those schemas — no `type`, `enum`, `const` or `$ref`, but
`properties`, `required`, `additionalProperties`, `patternProperties`,
`prefixItems` or `items` present, recursing through `allOf`/`anyOf`/`oneOf`
branches — `validateGuard` now returns a `Check<T>` instead of a `Guard<T>`: the
same runtime function, no type predicate. Every schema that declares a `type` (or
`enum`/`const`/`$ref`) keeps its predicate, and so does a schema whose type is not
a literal — narrowing is surrendered only when the inference is *demonstrably*
partial, never because the checker could not decide.

`Check<T>` keeps the erased phantom carrier `Validator` already uses, so
`Infer<typeof check>` still recovers the schema's type rather than collapsing to
`never`, and it is assignable anywhere `(input: unknown) => boolean` is. It reads
as "checks for this, does not claim it".

The runtime is untouched. This mirrors the same fix in
`@amritk/generate-validators`, whose generated `isX` had the identical hole — the
two now tell one story about the same schemas, and the type-level predicate sits
next to `ImplicitShape` so the keyword lists cannot drift apart.
