---
'@amritk/generate-validators': patch
'@amritk/resolve-refs': patch
'@amritk/helpers': minor
'@amritk/yaml': patch
---

Fix several correctness issues surfaced by a code review:

- **yaml**: negative hexadecimal and octal scalars (`-0x10`, `-0o10`) no longer
  have their sign double-applied and flipped positive; out-of-range or malformed
  `\x`/`\u`/`\U` escapes in double-quoted scalars are now treated as literal text
  instead of throwing a `RangeError` (via `String.fromCodePoint`) or silently
  dropping the following characters.
- **resolve-refs**: `pointerToPath` only coerces canonical RFC 6901 array-index
  tokens to numbers, so a numeric object key with a leading zero such as `"01"`
  is kept as a string rather than aliased to a different key. The shared
  JSON Pointer segment decode is now factored into one helper.
- **generate-validators**: object/array `const` checks compare with a new
  order-independent `valuesEqual` runtime helper instead of `JSON.stringify`, so
  a reordered-but-equal value matches (in step with the interpreter);
  `propertyNames` now validates every key against the full subschema (length,
  enum, const, `$ref`), not just the `pattern` form; and the draft-04 boolean
  `exclusiveMinimum`/`exclusiveMaximum` form is honored.
- **helpers**: add `hasStrictExclusiveMinimum` / `hasStrictExclusiveMaximum`
  guards for the draft-04 boolean exclusive-bound form.
