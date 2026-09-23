---
"@amritk/validation": minor
"@amritk/mjst": patch
---

`coerceX` now coerces inside `anyOf` / `oneOf` branches. Before, a union coerced a scalar only when every branch was a plain scalar type; an object branch, a `$ref`, a constrained scalar or a nested union left the whole position untouched. So `{ enabled: "true" }` under `anyOf: [string, { enabled: boolean }]` was rejected, even though the same `{ type: "boolean" }` outside a union was coerced.

The order is observable, so here it is:

1. A branch the value already matches, as written, wins, and nothing is coerced. Under `anyOf: [{ type: "string" }, { const: false }]`, `false` stays `false`. Ajv turns it into `"false"` because it coerces into the first branch that will take the value.
2. Otherwise each branch coerces the value its own way, and a result counts only if that branch then matches it. "Matches" is the validator's own verdict for that branch.
3. If the branches that match after coercion disagree on the value, nothing is coerced and the validator reports the value as written. If they agree, that value is taken. The order the branches were written in never changes the answer.

This changes behaviour. Values that used to be rejected under a union may now be coerced and accepted. A union with a constrained scalar branch is now judged branch by branch: under `anyOf: [{ type: "string", minLength: 3 }, { type: "number" }]`, `"7"` becomes `7` where it used to stay `"7"` and fail. `coerceUnion` also counts two offered types that coerce to the same value as one reading, so `"1"` under `number | integer` becomes `1` instead of being declined.
