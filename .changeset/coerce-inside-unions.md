---
"@amritk/validation": minor
"@amritk/mjst": patch
---

`coerceX` now coerces inside `anyOf`, `oneOf`, `allOf` and `if`/`then`/`else`, and beside a `$ref`. Before, a union coerced a scalar only when every branch was a plain scalar type. An object branch, a `$ref`, a constrained scalar or a nested union left the whole position untouched, so `{ enabled: "true" }` under `anyOf: [string, { enabled: boolean }]` was rejected, even though the same `{ type: "boolean" }` outside a union was coerced.

The order at a union is observable, so here it is:

1. A branch the value already matches, as written, wins, and nothing is coerced. Under `anyOf: [{ type: "string" }, { const: false }]`, `false` stays `false`. Ajv turns it into `"false"` because it coerces into the first branch that will take the value.
2. Otherwise each branch coerces the value its own way, and a result counts only if that branch then matches it. "Matches" is the validator's own verdict for that branch.
3. If the branches that match after coercion disagree on the value, nothing is coerced and the validator reports the value as written. If they agree, that value is taken. The order the branches were written in never changes the answer.

`allOf` coerces through each subschema in turn. `if`/`then`/`else` coerces toward `then` when the value, as it stands after the node's own properties were coerced, matches `if`, and toward `else` otherwise.

`coerceX` is faster than Ajv's `coerceTypes` on every case in the new `bench:validators:coerce` comparison, on Bun and on Node. Against Ajv cloning its input first, it is 3–36× faster on valid input, 1.4–2× on input that needs coercing, and 1.6–3.4× on input that cannot be coerced. Three changes make that happen:

- A valid document is answered by `isX` and handed back as the same object, without being walked, wherever `isX` is a standalone guard.
- Union branch tests are emitted as plain functions instead of closures.
- The walks only check `Object.hasOwn` on a value that is about to be written.

A boolean check of a `$ref` inside `validateX` (an `anyOf`/`oneOf`/`not`/`if` branch, or an array tail) now calls the target's `isX` instead of its `validateX`, so a branch that fails builds no errors. Such files now import `isX` too.

This changes behaviour. Values that used to be rejected under a union, an `allOf` or a condition may now be coerced and accepted. A union with a constrained scalar branch is now judged branch by branch: under `anyOf: [{ type: "string", minLength: 3 }, { type: "number" }]`, `"7"` becomes `7` where it used to stay `"7"` and fail. `coerceUnion` also counts two offered types that coerce to the same value as one reading, so `"1"` under `number | integer` becomes `1` instead of being declined.
