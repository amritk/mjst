---
'@amritk/generate-parsers': patch
'@amritk/helpers': patch
---

Fix five shape combinations where the generated TypeScript did not compile.

Found by a new fuzz suite that type-checks *fuzzed* documents — `$defs`, `$ref`s,
embedded helpers and the index barrel compiled as one program, the way a consumer
compiles them — across every option the generator exposes. The existing
`generated-code-types` corpus is hand-picked, and none of these shapes were in it.

Four of the five have one cause: an expression TypeScript cannot narrow, read
twice. A property named after an `Object.prototype` member is read through a
conditional (`Object.hasOwn(input, "constructor") ? … : undefined`), so
`Array.isArray(<expr>) && <expr>.length` reported "Object is of type 'unknown'";
the subschema matcher's record view (`x as Record<string, unknown>`) and its
tuple-element view (`x as unknown[]`) are cast expressions with the same problem.
Each now carries a type the repeated read can use — nothing real is given up,
since the value behind it genuinely is unknown and every read sits inside a
runtime guard that tests it. The `.every` callbacks that hang off those accessors
carry an explicit parameter type, so they cannot come out implicitly `any`.

The fast path's object literal was asserted with a plain `as T`. That looked
checkable and was not: `_x !== undefined` narrows an `unknown` read to
`{} | null`, which TypeScript then refuses to convert to a `$ref` type, and
`Array.isArray(_x)` narrows it to `any[]`, which it refuses to convert to a
tuple. It is `as unknown as T` now — the guard above it is what proves the shape.

Finally, the non-object fallback literal is asserted whenever a prototype-member
name appears anywhere in the subtree it builds, not only at the top level: a
nested `{ "0": "" }` against an item type declaring `constructor?: true` carries
an inherited `constructor: Function` that does not assign. The assertion is
`as unknown as T` for the same index-signature reason.
