---
'@amritk/generate-parsers': minor
---

Validate nested enums and $refs inside array items, closing the last
array-element gap from downstream use:

- Array properties whose `items` is an inline object schema now get a private
  item sub-parser and shape predicate (`OrderLinesItem` for `Order.lines`),
  wired through `validateArray` in both modes: strict mode throws on a bad
  element value (including nested enum and `$ref` violations), coerce mode
  repairs each element to a valid instance. Previously such elements passed
  through with only an `Array.isArray` check. Fast paths and the exported
  `validate{Type}Shape` predicates prove every element via the item predicate.
- Enum array items are coerced element-wise in lax mode (a non-member becomes
  a member instead of leaking through), matching how enum properties already
  behaved.
- Root-level array definitions delegate rich item schemas to a real parser:
  `$ref` items call the imported parser via `validateArray`, inline object
  items get a local `{Type}Item` sub-parser. Previously both were spread
  through unchecked even in strict mode.
- The strict-union trust walk (`canEnforceUnion`) now mirrors the emitted
  shape validators *deeply*: a `$ref` branch whose validator is built on a
  stubbed sub-predicate (e.g. an inline object or array-item schema containing
  an uncheckable property) is no longer trusted, so strict union enforcement
  can never reject valid input through a conservative stub.

The Ajv differential fuzzer's oracle now keeps `items` for enum and
inline-object item schemas, so element conformance is fuzz-checked instead of
out of scope.
