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

Fast-path optimizations recover (and beyond the array-items case, beat) the
throughput cost of the new element validation:

- When every declared property is required, the no-undeclared-keys test is an
  own-key count (`Object.keys(input).length === N`, sound because the typed
  checks prove all N keys present) instead of a per-key `for..in` walk — this
  also speeds up closed nested objects that were already validated before.
- Array-item guards use a generated loop helper instead of
  `Array.prototype.every`'s callback protocol.
- A *private* nested-object or array-item parser in strip mode hands a clean
  value (already exactly the declared shape, proven by its deep guard) back by
  reference instead of allocating a rebuild — the same sharing the parent
  fast-path literal already performs. Exported root parsers still return a
  fresh object.

Two subtle semantic alignments come with this: the strict unknown-key check
iterates own keys (`Object.keys`) rather than `for..in`, matching Ajv's
JSON-data-model view (inherited JS properties are no longer rejected), and
strip-mode output may share identity with clean nested input values (it always
shared them for `{ ...input }` fast paths).

Bench delta vs the previous release on the Order shape (array of closed
3-field items): strict parse throughput is now on par instead of −23%, safe
(strip) mode −6% instead of −19%, and the count form makes several closed
shapes faster than before (`assert-strict` +80%).
