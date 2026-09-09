---
'@amritk/generate-parsers': minor
---

Dispatch and repair union values by scoring their branches

A coercing parser promises that whatever it returns is a valid instance of the
schema that produced it. A union-typed value broke that promise outright: unless
its branches were `$ref`s sharing a discriminant, the generator emitted a blind
`input as T` cast, so every element of a union-typed array was handed back
exactly as it arrived. Measured over 4000 mutated documents of the published
Scalar configuration schema, **2118 coerced outputs were invalid** against their
own schema. **18 now are**, and all 18 are the one shape called out below.

A union parser is now built in two steps:

- **Recognition.** Each branch's shape predicate runs first, so a value already
  in a branch's shape takes that branch's parser and comes back unchanged. Valid
  input costs one predicate call, is never rebuilt, and never reaches the
  scoring.
- **Scoring.** A value matching no branch is scored against every branch and
  repaired toward the best fit. A `const` tag is near-decisive: a matching tag
  names the branch, a present-but-wrong tag rules it out. Below that a present
  required property is strong evidence, and a present, well-typed declared
  property is weak evidence. Ties keep the earliest branch, matching `anyOf`
  order.

Scoring is what makes the choice defensible rather than positional. Repairing
`{ name, folder }` toward whichever branch is written first would invent the
`sidebar` that branch requires and discard the `folder` the author actually
wrote; reading the keys that are present picks the branch they came from. Every
term is decided at build time, so the emitted code is a few property reads and
no schema walking.

This covers unions reached as a definition, as an array's `items` (including
recursive ones, where a branch's parser calls back into the dispatcher), and
unions whose branches are scalars rather than objects.

**Behaviour change:** a top-level union now repairs a non-member by *coercing*
it toward the best branch instead of discarding it for that branch's default, so
`{ anyOf: [{ type: 'string' }, { type: 'number' }] }` turns `true` into `"true"`
rather than `""`. This is what a property of the same shape has always done —
the top-level union was the only place in the generator that threw a coercible
scalar away. `undefined` still falls back to the default, having nothing to
convert.

Still outside the contract: a union written directly as a *property value*
(rather than as a definition or an array's `items`) is not dispatched, and a
value matching no branch is passed through. Ajv's `coerceTypes` rejects those
documents rather than repairing them, so this is not a gap against Ajv.
