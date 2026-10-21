---
'@amritk/validation': patch
'@amritk/helpers': minor
---

Faster generated validators on documents whose objects declare many optional properties, such as OpenAPI descriptions and large config files. Verdicts, errors and error order are unchanged; the generated code is different.

- **Key dispatch.** An object schema with eight or more optional properties now reads them with one `for…in` + `switch` over the keys the instance actually has, instead of one named read per declared property. Reading a property an object does not have is what a document of varied shapes paid for most: an OpenAPI Schema Object declares 35 properties and usually carries two or three. Every check still runs in declared order from a local, so `validateX`, `checkX`, `isX` and the `coerceX` fast path report exactly what they did. With `additionalProperties: false`, the unknown-key sweep only runs when the walk met an undeclared key. On a 1.5 MB OpenAPI 3.0 document under Node, `isX` drops from about 10 ms to 5.4 ms, `coerceX` from 9.3 ms to 5.2 ms, and an all-errors `validateX` of an invalid copy from 17 ms to 13 ms. Schemas whose properties are all required keep the named reads, which are faster for objects that all have the same shape.
- **Literal patterns.** A `pattern` or `patternProperties` key that is only literal characters (`^x-`, `^\/`, `^\$ref$`) is tested with `startsWith`, `endsWith`, `includes` or `===` instead of a regex, in every generated validator, guard and parser. The `additionalProperties: false` sweep tests its patterns with an unrolled `||` instead of `.some(…)` over an array.
- **`@amritk/helpers/escape-regex-pattern`** exports `regexTest(pattern, subject)`, which builds that expression, and `literalPattern(pattern)`, which says whether a pattern is a literal and where it is anchored.

A dispatched property is read only when it is an enumerable key of the object or its prototype chain, which is everything a JSON document or `JSON.stringify` carries. A non-enumerable own property under one of those names is now treated as absent. Prototype-member names (`constructor`, `toString`, …) keep their own-property read.
