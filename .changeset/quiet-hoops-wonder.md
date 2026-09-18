---
'@amritk/generate-validators': minor
'@amritk/generate-parsers': minor
'@amritk/helpers': minor
---

Fix five defects in the generated types, found by running the generators over
the official OpenAPI 3.0/3.1/3.2 JSON Schemas. Every one of them produced output
that either failed to compile or quietly said something the schema does not.

**A `oneOf`/`anyOf` branch that only lists `required` is now read against the
schema composing it.** `oneOf: [{ required: ['schema'] }, { required:
['content'] }]` is how "exactly one of these keys" is written; rendered on its
own such a branch declares nothing, came out `unknown`, and was dropped as an
empty intersection member — so OpenAPI's Parameter Object had both keys optional
and no way to tell its two forms apart. It now contributes `{ schema:
SchemaObject } | { content: ContentObject }`: the constraint the schema states,
and a union TypeScript narrows on.

**A union is bracketed before it is intersected.** `&` binds tighter than `|`,
so an array-form `type` joined raw produced `{…} | boolean & Core & Applicator`
— read as `{…} | (boolean & …)`, a different type that, because nothing
satisfies its second branch, threw away every keyword the JSON Schema
meta-schema defines.

**A `default` no longer guesses a type next to a composition keyword.** A
`default` is an annotation, not a constraint. Guessing from one beside a `oneOf`
intersected the guess with the branches, and OpenAPI 3.0's `additionalProperties`
property — `{ oneOf: [Schema, Reference, { type: 'boolean' }], default: true }` —
became `boolean & (SchemaObject | ReferenceObject | boolean)`, so an ordinary
`additionalProperties: { type: 'string' }` stopped type-checking.

**`$ref` imports no longer drift from the emitted text.** A `$ref` the type
generator inlines *through* — an `allOf` member naming a conditional definition,
which OpenAPI's security scheme uses for every auth type — was named in the
composing file with nothing importing it (`TS2304`), while the definition's own
file imported it and rendered nothing (`TS6133`). Both collectors now follow the
same inlining, and both decide each binding by what the emitted code actually
spells, reading past comments and string literals so a `description` mentioning
a definition is not mistaken for a use of it.

**Extension keys are no longer swallowed by an index signature.** Wherever the
schema composes the specification-extensions record, the generated type has to
leave the `x-` key space free for it — and keyed on `string`, an index signature
covers `x-foo` too and forces it to the mapped value type, so intersecting
`Record<`x-${string}`, unknown>` on top changed nothing. Three things follow:
a map-shaped type keeps the `allOf` members and sibling `$ref` it composes
(returning the map alone dropped them, which is why the Paths Object imported a
name it never used); a `patternProperties` key is narrowed to the prefixes the
pattern can start with (`` `/${string}` `` for Paths, `` `1${string}` `` …
`` `5${string}` `` for Responses) rather than collapsing to `string`; and each
pattern gets its own index signature instead of the block collapsing onto one
key with every pattern's value type unioned. All 75 types across the three
schemas that the spec lets carry an `x-` key now accept one — previously the
Paths and Responses Objects of every version did not.

**A `patternProperties` that only re-lists declared property names contributes
no index signature.** OpenAPI's Components Object enumerates all ten of its own
keys as an alternation so `unevaluatedProperties` can work; as an index
signature that had to widen to cover every declared property, landing
`[key: string]: unknown | …` on the type and disabling excess-property checking
for the whole object.

Two smaller fixes fall out of the above: the meta-schema pass-through parser
emits its `typeof input === 'boolean'` branch only where the schema admits the
boolean shorthand (3.1 and 3.2 do, 3.0 does not), and a coercing parser's
non-object fallback is asserted to its type when the schema composes a union it
cannot land in.

All three latest official OpenAPI schemas now generate types, parsers and
validators that compile clean under `--strict --noUnusedLocals`, and the
generated 3.1 validators agree with a reference JSON Schema 2020-12
implementation on the vendored OpenAPI corpus and on hand-written cases covering
`unevaluatedProperties`, `if`/`then`, `dependentSchemas`, `oneOf` and
`$dynamicRef`.
