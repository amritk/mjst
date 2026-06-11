---
"@amritk/generate-validators": minor
---

Generate a boolean type-guard `isX(input): input is X` alongside every
`validateX`. Where `validateX` returns a rich `ValidationResult` (and routes a
failure to a separate error-collecting function), `isX` is a single flat boolean
predicate — no error array, no cold-path call — so V8 inlines it like a
hand-written `check`, matching the shape of TypeBox's compiled checker. It
returns the *exact same verdict* as `validateX` (constraints are emitted as the
negation of the validator's error condition, so even edge values like `NaN` on a
constrained number agree); when a schema carries something the flat form can't
mirror ($ref, unions, `const`, x-mjst, pattern/dependent keywords), `isX` falls
back to `validateX(input) === true`, which is always correct. The guard is
re-exported from the generated `index`, giving consumers an allocation-free
predicate for the common "is this valid?" check.
