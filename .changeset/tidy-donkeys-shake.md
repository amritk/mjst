---
'@amritk/generate-parsers': minor
'@amritk/generate-validators': patch
'@amritk/generate-examples': patch
'@amritk/helpers': minor
---

Close the gaps between the emitted TypeScript types and the schemas they come from

The shared type generator read past several keywords, so the type it emitted
described fewer documents than the schema allowed — and the parsers built from
it disagreed with it. Generating the whole vendored OpenAPI corpus (982
component schemas, 5,872 files) and compiling the result under `strict` went
from 667 type errors to none.

**Types**

- `nullable: true` (OpenAPI 3.0) now widens the type with `| null` — 432
  occurrences in the vendored corpus were previously typed as non-null, which
  also made `generate-validators`' `input is T` predicate unsound, since its
  validator accepts null.
- An array-form `type` keeps the shape it declares: `["object","null"]` with
  properties is `{ … } | null` instead of `Record<string, unknown> | null`, and
  `["array","null"]` keeps its item type. Members are deduplicated, and
  `readonly` applies to them.
- `prefixItems` (and the draft-07 array form of `items`) emits a tuple instead
  of `unknown[]`, with positions optional past `minItems` and the tail typed
  from the sibling `items`/`additionalItems`.
- Keywords declared *alongside* `properties` are no longer dropped: `allOf`
  members written inline (not just `$ref`s) and sibling `oneOf`/`anyOf` unions
  are intersected in, `additionalProperties`/`patternProperties` become an index
  signature, and a nested schema with both `properties` and a union keeps both.
- A `description` or `$comment` containing a comment terminator no longer ends
  the JSDoc block early — a glob like `**/*.ts` in a description used to make
  the whole generated file unparseable.
- A URI `$ref` that resolves inside the document is named rather than typed
  `unknown`, matching the import the same file already emits for it.

**Parsers**

- An array-form `type` is enforced: strict parsers assert the disjunction (plus
  the constraints of the non-null member) instead of emitting no check at all,
  and the shape validator keeps a real fast path instead of degrading to a stub.
- Inline `allOf` members are enforced in strict mode, and the fast path no
  longer jumps over those assertions.
- A `required` key with no declared property is asserted present.
- Tuple positions declared with the draft-07 array `items` are checked.
- A `default` that contradicts its declared `type` is ignored rather than used
  as a coercion target.
- Root-level tuple and item assertions are emitted once, not twice.
- A file no longer imports from itself when a definition's name collides with
  the root type name, and colliding definition names are reported: two that
  reduce to one filename mean only the first is generated.
