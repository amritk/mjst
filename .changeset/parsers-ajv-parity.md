---
'@amritk/generate-parsers': patch
'@amritk/helpers': patch
---

Bring the strict parser up to Ajv's assertion vocabulary, and stop refusing the
keywords it can now prove.

The exact subschema matcher — the thing strict mode enforces `contains`,
`propertyNames`, `not` and `dependentSchemas` through — only understood a
fraction of Draft 2020-12, and every gap in it became either a generation-time
refusal or a keyword nothing checked. It now covers `$ref` (JSON Pointer,
`$anchor`, and the 2020-12 rule that a ref's *siblings* still apply),
`prefixItems` with its `items` tail, `items: false`, `contains` with
`minContains` / `maxContains`, `patternProperties`, a schema-valued
`additionalProperties`, `propertyNames`, `dependentRequired`,
`dependentSchemas`, array-form `type`, structural `const`, and an empty `enum`.

Built on that:

- **`unevaluatedProperties` / `unevaluatedItems` are implemented** rather than
  rejected at generation time. The emitted check computes the same annotation
  coverage the runtime interpreter collects — keys and indices evaluated by
  `properties`, `patternProperties`, `additionalProperties`, `prefixItems`,
  `items`, a satisfied `contains`, `allOf` members, a `$ref` target, a *matching*
  `anyOf` / `oneOf` branch, an `if` / `then` / `else` arm, and a triggered
  `dependentSchemas` entry — and applies the unevaluated schema to what is left.
- **A whole-schema backstop** now stands behind the per-property assertions, so
  the keywords no flat check can express are enforced instead of dropped: a
  `$ref` that no imported parser validates (single-file builds, `allOf` members
  of a property-less object, array `items`, tuple positions), a `$ref` with
  constraining siblings, `items: false`, and constraint keywords with no `type`
  to hang them on (`{ minimum: 5 }`, `{ required: ['a'] }`). The fast path and
  the shape validator decline for those same shapes, so nothing can skip past
  the check.
- **A `type` with more than one non-null member** keeps each family's
  constraints: `{ type: ['string','array'], minLength: 3, minItems: 2 }` bounds
  the string by length and the array by count.
- **`minLength` / `maxLength` count Unicode code points**, as JSON Schema
  specifies — `"💩"` no longer satisfies `minLength: 2`, and `"💩💩"` no longer
  violates `maxLength: 2`. The exact count is only scanned inside the narrow band
  where the cheap UTF-16 unit count cannot decide, so ASCII input allocates
  nothing and `minLength: 1` compiles to a plain length test.
- **A `false` schema rejects every value** instead of casting it through, and a
  strict `if` / `then` / `else` root asserts the conditional instead of building
  a result from the branch fragments (which invented properties the input never
  had).
- **A nullable object root** (`type: ["object","null"]` with `properties`) accepts
  `null`, which the object parser's `isObject` guard used to reject.
- **A recursive root `$ref: "#"`** is generated as the root's own type, the way a
  root `$dynamicAnchor` already was. It previously emitted an import of a
  `ref-<hash>.ts` that was never generated — output that did not compile at all.
- The generation-time guard walks *schema* positions only. It used to inspect
  every object in the document, so a schema declaring a property named `items`,
  `not` or `contains` was checked as though the property name were the keyword.

Parity is held by a new differential fuzz suite (`parser-vocabulary-conformance`)
over that vocabulary, plus the existing shape, composition and strict fuzzers,
with Ajv 2020 as the oracle. Three departures from Ajv are deliberate and
documented in the README: `format` stays an annotation (Ajv's own default),
`multipleOf` keeps the magnitude-scaled tolerance the whole toolchain shares, and
a type-less schema with `properties` still requires an object because the parser
must return the type it declares.
