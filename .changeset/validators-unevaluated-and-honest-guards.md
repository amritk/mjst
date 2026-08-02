---
'@amritk/generate-validators': major
---

Generate `unevaluatedItems` / `unevaluatedProperties`, and stop `isX` claiming a
narrowing it cannot make

**On the official JSON Schema Test Suite: 987/1299 → 1238 / 1299 (95.3%).**

The position that flat generated code cannot carry annotations across the
applicator tree turned out to be wrong, and it was costing 201 cases — two thirds
of everything this package failed. Both keywords are now emitted as a flat
*expression* computing what the interpreter computes as annotations: for each key
or index, a boolean that is true when some keyword evaluated it. Keywords that
must succeed for the value to be valid at all (`allOf` members, a `$ref` target, a
satisfied `contains`) count unconditionally — sound, because the emitted test is
one conjunct of a validator that also asserts them — while conditional applicators
(`anyOf`/`oneOf` branches, `if`/`then`/`else`, `dependentSchemas`) carry their
condition, hoisted to a `const` before the loop so a per-key sweep reads a boolean
instead of re-running a match.

`contains` publishes only the indices it matched, per the spec and
`@amritk/runtime-validators`, rather than Ajv's whole-array mark.

Four shapes still refuse, each with a message naming the shape rather than the
keyword: coverage running through a `$dynamicRef`, an unresolvable or cyclic
`$ref` at the same instance location, a walk deeper than eight applicators, and a
node under `additionalItems`. No case in the suite hits any of them.

Parity with the interpreter is the contract and is enforced as one:
`interpreter-parity.test.ts` gains six hand-written groups plus a 500-schema ×
24-value fuzz pass — 12,000 pairs, no divergence.

**`isX` no longer lies.** For a schema with no `type`/`enum`/`const`/`$ref` but
object-shaped keywords (recursively, so a union of implicit-object branches counts
too), the emitted type describes the object case while the validator — correctly —
also accepts non-objects. The guard now returns `boolean` for exactly those
schemas instead of `input is X`; the check itself is unchanged and still in
lockstep with `validateX`. Every schema that declares a `type` keeps its type
predicate.

The complete fix is to widen the emitted type so the narrowing becomes true, which
lives in `@amritk/helpers/generate-type-definition` and has to move together with
`FromSchema`'s `ImplicitShape` in `@amritk/runtime-validators`, since both make the
identical inference for the identical schema. Until they do, a guard that declines
to narrow beats one that narrows wrongly.

Also inherited from `@amritk/helpers`: `$ref`s written against an enclosing `$id`
now resolve, which closed most of this package's ref failures without a change
here.
