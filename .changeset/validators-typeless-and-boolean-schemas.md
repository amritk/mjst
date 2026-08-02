---
'@amritk/generate-validators': major
---

Enforce the keywords a schema declares without a `type`, and stop emitting
validators that call functions nobody wrote

Measured against the official JSON Schema Test Suite, generation goes from
818/1299 to **987/1299 (76.0%)**.

- **A schema with no root `type` compiled to `validateRoot = () => true`.** The
  generator hung every check off the declared type, so `{ "minLength": 2 }`,
  `{ "required": ["a"] }`, `{ "uniqueItems": true }`, `{ "contains": … }`,
  `{ "patternProperties": … }`, `{ "propertyNames": … }` and
  `{ "dependentRequired": … }` all accepted everything — the largest silent gap
  this generator had. Each keyword now emits its check behind its own runtime type
  test, so it rejects its own family and ignores every other kind of value, which
  is what JSON Schema means by a type-less constraint. The same gate was
  suppressing constraint checks next to a root combinator, so
  `{ allOf: [{ prefixItems: … }], items: … }` silently dropped its `items` too.
- **Object keywords no longer imply `type: "object"`.** `{ "properties": … }`
  ignores a non-object instead of rejecting it, matching the interpreter. Note the
  inferred TypeScript type still describes the object case (as
  `FromSchema`/`ImplicitShape` in `@amritk/runtime-validators` does), so for that
  shape `isX` is a weaker type guard than it was — the verdict, which is the
  contract, matches the interpreter exactly.
- **Boolean subschemas do something.** A root of `false` rejects every instance
  (it used to accept them all), and a `false` sitting in a `properties`, `allOf`,
  `then`/`else`, `patternProperties`, `dependentSchemas`, `prefixItems`,
  `contains` or `propertyNames` position now emits a real check.
- **A `not` over a `type` array emitted nothing**, and "no checks" is how the
  matcher spells "matches everything" — so the `not` rejected every instance.
- **Unresolvable `$ref`s produced output that does not compile.** For a ref the
  walker never queues (a relative path, an absolute path, a URN), the emitter
  derived a name from the ref string and called `validateIntJson(…)` without
  anything emitting it. Generation now refuses, naming the ref — the same answer
  the other unsupported paths already give, and a failure next to its cause rather
  than in the consumer's build.
- **String lengths count code points, not UTF-16 units**, in both the validator
  and the guard, via the shared `@amritk/helpers/string-length-check` (`.length`
  stays the short-circuiting first term).

`unevaluatedItems`/`unevaluatedProperties` still refuse at generation by design —
flat output cannot carry annotations across the applicator tree — and `$id`
base-URI resolution remains unimplemented, so those refuse rather than guess.
