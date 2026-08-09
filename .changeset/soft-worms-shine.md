---
'@amritk/generate-validators': minor
---

Fix eleven bugs found by an audit of the validator generator. The first three
are one bug wearing three hats, and it is the headline: a generated validator
could accept documents the schema forbids.

### Wrong verdicts

- **A `const` or `enum` silently dropped every sibling keyword.** The emitter was
  a chain of `if (keyword) { emit; return }`, so the first keyword it recognised
  swallowed the rest: `{"type": "string", "const": 1}` compiled to an equality
  check and nothing else, and the generated validator accepted `1`. It reproduced
  under `properties`, `items`, `prefixItems`, `contains`, `additionalProperties`,
  `patternProperties`, `propertyNames`, `dependentSchemas`, `not`,
  `if`/`then`/`else` and `allOf`, and at the document root. The keyword emitters
  now compose instead of dispatching, with the presence check for a `required`
  property hoisted so it is still reported once.
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
  `additionalItems` tail are now read as the tuple they are — with `prefixItems`
  taking precedence when a node carries both, matching the type generator and the
  runtime interpreter. Each dialect's closing keyword now applies only within its
  own dialect: `additionalItems: false` next to a 2020-12 `prefixItems` capped a
  length that Ajv, the interpreter, and the tuple type emitted beside it all
  leave open.
- **Error paths built from a runtime key were not JSON-Pointer escaped.** A
  `patternProperties` match, an `additionalProperties` sweep or a `propertyNames`
  loop reported `{"a/b": …}` at `/a/b`, which reads back as the child `b` of a
  property `a`. Keys the schema names statically were always escaped, and
  `@amritk/runtime-validators` escapes the same way; the runtime ones now do too,
  via an `escapePointer` helper in the emitted `validation-result.ts`.

### Unsound `isX` guards

The flat boolean guard must never accept what `validateX` rejects. Three ways it
did:

- A `required` key with no `properties` entry contributed no condition at all, so
  `isX({})` answered `true` for `{"type": "object", "required": ["a"]}`.
- `items: false` was ignored (`hasItems` is false for a boolean `items`), so
  `isX([1])` answered `true` for an array schema admitting no elements.
- A draft-07 tuple was read as a tail schema and produced no per-item test.

An `enum` carrying a constraining sibling is now composed with it rather than
answered by membership alone — which was the unsound reading — while keeping the
inline guard for `{"type": "string", "enum": [...]}`, the commonest shape in an
OpenAPI document.

### Generated output that does not compile

Compiling every generated file set in the two vendored corpora (1,361 schemas,
under the flags `generated-code-types.test.ts` already declares) found 61
TypeScript diagnostics. Both corpora now compile clean.

- A combinator branch the compiler can decide statically was still emitted as a
  live condition, leaving provably unreachable code (58× `TS7027`): an `anyOf`
  with a `true`/`{}` branch, and a boolean `if` or `not`. These fold now, with no
  change of verdict.
- A `type: "object"` root read its combinator branches against the narrowed
  `Record<string, unknown>`, so a branch from another family compared an object
  against a string (`TS2367`, plus a cascade on `never`). The same applied to a
  `dependentSchemas` / `dependencies` subschema, which is applied to the object
  itself.
- A guard member and an `unevaluated*` key both read through a cast, which no
  `typeof` in front can narrow, so a constrained check emitted `.length` on
  `unknown` (`TS2571`).
- An `enum` member of a different JSON type than the sibling `type` sat behind
  the `typeof` that narrows the accessor, so it compared two disjoint types
  (`TS2367`). Such a member can never match, and is dropped.

### Generation that fails late instead of loudly

- **A `$defs` entry named `index` or `validation-result` was skipped silently.**
  Its importers were still generated, so the output carried an
  `import { validateIndex } from './index.js'` that nothing satisfies — a
  `TS2305` when built and a `SyntaxError` when run. Generation now refuses and
  names the definition, the same answer two definitions competing for one
  filename already get. A root type name that collides is refused too, instead of
  producing no root validator.
- A `$ref` in a position the emitter never reaches (`additionalItems` with no
  array `items`; `then`/`else` with no `if`; a branch of an `anyOf` the emitter
  folds away, or the arm a statically-known `if` drops) was collected as though
  it were, so the output carried a dead import — or generation refused a
  perfectly good schema when the ref happened to be unresolvable.

Three JSON Schema Test Suite cases move from expected-failure to passing as a
result (two `$id`-scope cases and one `$dynamicRef` case, all of which needed a
root `$ref`'s siblings to be enforced), leaving 7 documented gaps.
