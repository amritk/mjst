---
'@amritk/generate-validators': major
'@amritk/generate-parsers': major
---

Make both generators agree with Draft 2020-12 — and with each other — on
structural equality, tuple `items`, `oneOf`, and prototype-member property names.

The two generators disagreed with Ajv and with one another on the same schemas.
Where they differed, `generate-validators` was usually right: it already shipped
`valuesEqual` / `allUnique`, which `generate-parsers` never adopted.

**`@amritk/generate-validators`**

- A property named `__proto__` was silently dropped. The `nullable` rewrite runs
  over *every* schema and copied `properties` with a plain assignment, which fires
  the `Object.prototype` setter instead of creating a key — so
  `{"properties":{"__proto__":{"type":"string","minLength":3}}}` emitted a
  validator with no checks at all, and `required: ["__proto__"]` degraded to a
  bare presence check. A validation bypass.
- `constructor` / `toString` / `hasOwnProperty` properties were read straight off
  the object, so the *prototype's* value answered: a valid document was reported
  as `must be string` at `/hasOwnProperty`, and a required `toString` could never
  be reported missing (`'toString' in obj` is always true). Reads now go through
  an own-property guard, and presence uses `Object.hasOwn` — but only for the
  names that can actually be inherited. Every other key keeps the plain `in` it
  always had, because `Object.hasOwn` is a call the engine cannot fold the way it
  folds `in`, and spending it on `id` or `name` bought nothing while costing
  roughly half the throughput on an all-present object.
- `items` alongside `prefixItems` was applied to the prefix positions too. Per
  2020-12 `items` is the tail schema, so `{prefixItems:[{type:'string'}],
  items:{type:'number'}}` rejected `["a", 1, 2]` — which Ajv accepts, and which
  the `[string?, ...number[]]` type this generator emits already admits.
- `enum` members that are objects or arrays could never match: `.includes` is
  SameValueZero, i.e. reference equality. `enum` now compares structurally via
  `valuesEqual`, the way `const` always has — which also makes `isX` a sound type
  guard again.

**`@amritk/generate-parsers`**

- The same `prefixItems` + `items` defect, in both the fast path and the strict
  assertion.
- The same `enum`-with-object-members defect. Members are now compared by an
  unrolled structural check against the known literal.
- `const` deep equality used `JSON.stringify`, which is key-order sensitive, so
  `{b: 2, a: 1}` was rejected against `const: {a: 1, b: 2}` — and it serialized the
  whole value on every call to do it.
- `uniqueItems` used a `JSON.stringify` dedupe key (or a bare `Set`, which
  compares objects by reference), so `[{a:1,b:2},{b:2,a:1}]` was accepted where
  Ajv and `generate-validators` both reject. It now projects through a
  key-order-independent canonical form when items may be structural, keeping the
  cheap native `Set` when they are provably scalar. A root array of objects
  skipped the constraint entirely and now enforces it.
- `oneOf` exclusivity was not enforced — both `oneOf` and `anyOf` compiled to a
  plain disjunction, so a value matching two branches was accepted. `oneOf` now
  requires exactly one match.
- The array fallback was a bare `[]`, ignoring `prefixItems` and `minItems`. It is
  not an instance of its own schema, and against a required closed tuple it is not
  even assignable — `TS2322: Type '[]' is not assignable to type '[string,
  number]'` made non-strict and `readonly` output fail to compile.
- A schema property named after an `Object.prototype` member produced an
  unsatisfiable type: TypeScript reads the inherited `constructor: Function` on the
  fallback object literal and rejects it against `constructor?: string`.

Both packages now type-check their generated output under the repo's real
compiler flags (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), not
`strict` alone — `generate-validators` had no such suite at all — and both pin the
semantics above against Ajv (or, for prototype-member names, against
`@amritk/runtime-validators`, since Ajv has those bugs itself).
