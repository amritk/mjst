---
'@amritk/generate-examples': minor
---

Closes out the generated-file compile failures: a sweep of all 982
`components.schemas` entries in the vendored OpenAPI corpus now type-checks with
**0 failures** against the real `fast-check` declarations under the repo's strict
flags, down from 13% at the start of the review and 2.33% one round ago. That
sweep is now a test, so the number cannot drift back silently.

Fixes, all reproduced against the corpus or a schema reduced from it:

- **`oneOf`/`anyOf` replaced the node's own keywords instead of constraining them
  alongside.** `{ type: 'object', properties: …, anyOf: [{ required: … }] }` read
  the branch alone and answered `null` / `fc.anything()` against an object type.
  The node's own shape is now merged into each branch, and a branch whose `type`
  contradicts the node is dropped rather than re-admitting a value the type
  excludes.
- **`mergeAllOf` silently dropped a nested `allOf`.** A `oneOf` branch written as
  `{ title: 'Token Usage', allOf: [{ properties: … }] }` — the shape OpenAPI
  documents use for discriminated unions — merged down to just its `title`, so
  the whole variant's properties vanished and the example came out `{}`.
- **Object-likeness disagreed with the type generator.** It calls a schema an
  object on the *presence* of `patternProperties`/`additionalProperties`, and on
  `properties` whatever `type` says; this package tested the value's shape and
  dispatched on `type` first. Both now match it exactly.
- **`if`/`then`-only objects** get an assertion: the type generator folds the
  branch's properties in as required, and nothing structural tells the deriver to
  produce them.
- **An unresolvable `$ref` is no longer named by the arbitrary**, since the import
  collector deliberately skips it.
- **A `false` schema** types as `never`, which nothing is assignable to; both the
  arbitrary and the example now say so explicitly.
- **An exclusive bound equal to its opposite** (`exclusiveMinimum: 5, maximum: 5`)
  emptied the range `fc.double` had to draw from.
- **`k * multipleOf`** could exceed `fc.integer`'s inclusive 32-bit maximum by one.
- **`uniqueItems` with a closed `contains`** could not reach the required length
  and retried forever; elements now widen to "that value, or anything", which is
  the freedom the schema actually grants.
- **The runtime-validator import** was decided by a weaker condition than the one
  that emits the validator, so a schema the interpreter refuses earned an import
  nothing used.
