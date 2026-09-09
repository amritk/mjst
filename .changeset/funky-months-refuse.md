---
'@amritk/generate-parsers': minor
---

Dispatch a union written as a property value, closing the coercion gap

The scored dispatcher reached a union as a definition, as a `$ref`, and as an
array's `items`, but not one written directly under `properties`. Nothing claimed
it, so a value matching no branch was handed back untouched. That was the whole
of the remaining invalid-output gap on the published Scalar configuration schema
— all 41 of 4000 documents, every one at `siteConfig.logo`, whose `logo` is
`anyOf: [<uri string>, { darkMode, lightMode }]`.

A union property now gets the same private dispatcher an array's union items
get: match a branch's shape predicate, otherwise score the branches and repair
toward the best fit. Over the same 4000 documents, **every coerced output is now
a valid instance of its own schema** (was 41 invalid), and all 2514 documents Ajv
rejects are repaired into ones it accepts (was 2496). Strict verdicts are
untouched at 0 disagreements with Ajv — this path is coerce-only, and the map it
uses is local to the parser so the shape validator keeps its existing inline
union check and the two cannot drift.

**Also fixes a code-generation bug that reached `main`.** A dispatcher over
*scalar* branches repairs through an inline expression that re-tests the value's
type, and TypeScript narrows inside the arm a guard opened: after
`if (typeof input === "boolean") return …`, the string arm of the boolean token
table read `input.trim()` on `never`, so the generated file did not compile. It
needed both the scored dispatcher and the token-table boolean coercion to be
reachable, which is why neither change surfaced it alone. The repaired value is
now read through a binding declared `unknown` that the guards cannot narrow,
while the guards keep testing `input`. Emitted output for unions of objects and
`$ref`s is unchanged, so nothing pays for the alias that does not need it.

Two shapes stay on the general coercion path by design: a union carrying its own
keywords alongside its branches (`{ anyOf: […], required: […] }`), which a
dispatcher would silently drop, and a union of bare scalars in property position,
where scoring has no keys to read so every branch ties and the first wins —
exactly what that path already does.
