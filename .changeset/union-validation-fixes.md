---
'@amritk/generate-parsers': minor
'@amritk/helpers': patch
---

Close the generated-parser validation gaps found by the 0.7.15 evaluation:

- File-level union definitions (e.g. a recursive `expr` oneOf) now generate a
  real membership shape validator and a strict parser that throws on values
  matching no branch — recursively through branch `$refs` — instead of a
  `=> false` stub and a blind cast.
- A root `$ref` whose derived name collides with its definition (title `Expr`
  → `#/$defs/expr`) now merges the definition into the root file instead of
  emitting a self-importing wrapper that could not compile; non-colliding
  alias roots delegate their parser and shape validator to the target.
- `oneOf`/`anyOf` object properties are validated in strict mode (throw when
  no variant matches) and included in shape validators and fast paths, gated
  on every branch being provably checkable so a conservative stub validator
  can never reject valid input.
- Enum properties participate in shape validators and fast paths instead of
  forcing the `=> false` stub, so `validate{Type}Shape` no longer rejects
  valid input containing nested enums.
- Strict mode enforces array item types (scalars and enums) on the slow path
  and for root-level array schemas — a `string[]` field can no longer carry
  numbers past a strict parser.
