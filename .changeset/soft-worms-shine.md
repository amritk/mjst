---
'@amritk/generate-validators': minor
---

Fix six bugs found by an audit of the validator generator. The first three are
one bug wearing three hats, and it is the headline: a generated validator could
accept documents the schema forbids.

- **A `const` or `enum` silently dropped every sibling keyword.** The emitter was
  a chain of `if (keyword) { emit; return }`, so the first keyword it recognised
  swallowed the rest: `{"type": "string", "const": 1}` compiled to an equality
  check and nothing else, and the generated validator accepted `1`. It
  reproduced under `properties`, `items`, `prefixItems`, `contains`,
  `additionalProperties`, `patternProperties`, `propertyNames`,
  `dependentSchemas`, `not`, `if`/`then`/`else` and `allOf`, and at the document
  root. The keyword emitters now compose instead of dispatching, with the
  presence check for a `required` property hoisted so it is still reported once.
- **A top-level `$ref` dropped its siblings too.** `{"$ref": "#/$defs/s",
  "minLength": 3}` compiled to a bare delegation and accepted `"q"` —
  contradicting 2020-12, and contradicting the generator's own handling of the
  same shape under `properties`.
- **`$ref` siblings were dropped everywhere except `properties`,** where
  `type` / `const` / `enum` siblings were dropped instead. Wrong in both
  directions: `{"not": {"$ref": "#/$defs/s", "minLength": 3}}` made the inner
  schema broader than written, so it wrongly *rejected* `"a"`.
- **A draft-07 tuple (`"items": [...]`) produced no array validation at all**
  while the type generator emitted a real tuple type, so the emitted type and the
  emitted validator disagreed about the same schema. Array-form `items` and its
  `additionalItems` tail are now read as the tuple they are, which is what
  `unevaluatedItems` already did.
- **Error paths built from a runtime key were not JSON-Pointer escaped.** A
  `patternProperties` match, an `additionalProperties` sweep or a
  `propertyNames` loop reported `{"a/b": …}` at `/a/b`, which reads back as the
  child `b` of a property `a`. Keys the schema names statically were always
  escaped, and `@amritk/runtime-validators` escapes the same way; the runtime
  ones now do too, via an `escapePointer` helper in the emitted
  `validation-result.ts`.
- **A `$defs` entry named `index` or `validation-result` was skipped silently.**
  Its importers were still generated, so the output carried an
  `import { validateIndex } from './index.js'` that nothing satisfies — a
  `TS2305` when built and a `SyntaxError` when run. Generation now refuses and
  names the definition, the same answer two definitions competing for one
  filename already get. A root type name that collides is refused too, instead of
  producing no root validator.

Three JSON Schema Test Suite cases move from expected-failure to passing as a
result (two `$id`-scope cases and one `$dynamicRef` case, all of which needed a
root `$ref`'s siblings to be enforced), leaving 7 documented gaps.

The boolean guards (`isX`) were tightened to match: they bailed out of an `enum`
with constraining siblings, and of a draft-07 tuple, by answering with a partial
test — accepting values `validateX` rejects.
