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
key with every pattern's value type unioned, unless two of those key spaces
overlap. 75 of the 76 types across the three schemas that the spec lets carry an
`x-` key now accept one, where before the Paths and Responses Objects of every
version did not. The holdout is OpenAPI 3.0's Callback Object, whose
`additionalProperties` covers every key its adjacent `^x-` pattern does not:
writing that needs a `string` index beside a narrower one carrying a different
value type, which TypeScript rejects outright, so the map every
callback-expression key needs wins over the extensions.

**A `patternProperties` that only re-lists declared property names contributes
no index signature.** OpenAPI's Components Object enumerates all ten of its own
keys as an alternation so `unevaluatedProperties` can work; as an index
signature that had to widen to cover every declared property, landing
`[key: string]: unknown | …` on the type and disabling excess-property checking
for the whole object.

Review follow-ups, each verified against a case the vendored corpus does not
reach: the two import collectors no longer recurse forever on a conditional
definition that composes itself; the scan deciding whether a rendered member
needs bracketing skips JSDoc, so an apostrophe in a `description` cannot hide a
top-level union; `identifierMentions` reads comments, strings and regex literals
in one pass, so an emitted `pattern` whose first characters spell a comment
opener no longer blanks the imports below it; a union carrying an `unknown`
member collapses rather than reading as though its other branches still said
something; a pattern prefix that is template-literal syntax, or one arm of a
top-level alternation, takes the key back to `string`; a template-literal index
that covers a declared property widens like a `string` one; and the meta-schema
boolean branch asks what the rendered type spells rather than what JSON Schema
admits — including where a `$ref`, `allOf` or `oneOf` hands the type elsewhere.

A second review pass found five more, each reproduced before being fixed: two
narrowed key spaces that overlap (`^x-` beside `^x-a`) widen back to one
signature rather than emitting the `TS2413` pair; declared properties are read
before a boolean `additionalProperties`, which had started erasing them once a
self-listing pattern was dropped; the scan deciding whether a member needs
bracketing handles comments in the same pass as quotes, since a `const` of
`x/*y` renders as a literal whose characters open one; and the type emitter
gained the cycle guard the import collectors already had, so a conditional
definition composing itself no longer takes the depth cap down with it.

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
