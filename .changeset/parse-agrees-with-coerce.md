---
"@amritk/validation": minor
"@amritk/helpers": minor
"@amritk/mjst": patch
---

The coercing `parseX` now returns exactly what `coerceX` returns whenever `coerceX` accepts the document, and only repairs what `coerceX` would reject. That holds through `anyOf`, `oneOf`, `allOf`, `if`/`then`/`else`, `$ref` and recursion, and a differential test pins it over random schemas.

Before, a union, `allOf` or `if` in a parser was checked but never coerced into:

- `{ enabled: "true" }` under an `allOf` of a `$ref`'d union came through untouched.
- `5` under `anyOf: [string, { const: false }]` was repaired to `""`.
- Some already-valid documents were rewritten: `{}` under `anyOf: [{ type: integer }, { allOf: [...] }]` became `1`.

A scalar definition reached through `$ref` (`{ type: "number" }`) repaired `"-1"` to `0`, where the same schema written inline as a property coerced it to `-1`.

How it works: a definition whose own tree has `anyOf`/`oneOf`/`allOf`/`if`/`not` now carries an exact test (`matchesX`) and the validator's coercion walk (`coerceXInput`) in front of its repairing parser. Every definition such a one reaches through `$ref` carries them too. The repairing parser becomes the private `_parseXRepair`, and the index barrel now leaves out any export whose name starts with `_`.

This changes behaviour and output:

- Parse output changes for schemas with combinators: documents that used to be repaired are now coerced, and already-valid ones are returned unchanged. Parser code grows for such schemas, to about twice its size on a large OpenAPI document. Schemas without combinators emit exactly what they did before.
- A scalar definition now coerces its value the way a property of the same type does.
- `strict` and `stripUnknown` parsers are unchanged.
- Generated validators test each `anyOf`/`oneOf`/`not`/`if` branch through a named, shared function instead of an IIFE. JavaScriptCore allocated that IIFE's closure on every call. On a union-heavy config this makes `coerceX` about 2× faster on Bun, and `validateX` gains the same way. Output size is unchanged within 0.3%.
- A boolean test of a `$ref` calls the target's `isX`, so a failing branch builds no errors.
- The parser no longer declares nested shape checks and `_every…` item loops that no fast path reads. They were `TS6133` errors under `noUnusedLocals` on 37 of the 38 such cases in the OpenAI spec.

`@amritk/helpers` adds `@amritk/helpers/coercion-runtime` (`coerceScalar`, `coerceUnion`, `valuesEqual`, `allUnique`, `everyItem`, `escapePointer`). It is byte-identical to the runtime a validator build emits, and a test enforces that.

`bench:validators:node` and `bench:parsers:node` run under Node again. They import the generator through the package entry instead of extensionless source paths.
