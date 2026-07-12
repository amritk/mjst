---
"@amritk/generate-parsers": patch
---

Fix bugs surfaced by a security/correctness audit of the parser generator:

- Prototype safety: the parsers generated for `patternProperties` (and
  `properties` + `patternProperties`) with `additionalProperties: false` now
  guard their dynamic `for..in` key copy against `__proto__`, matching the
  existing `validateRecord` hardening. Previously a `__proto__` input key
  (own-enumerable via `JSON.parse`) matching a pattern reassigned the result
  object's prototype instead of being stored as an own property.
- `Record<string, integer>` coercion now rejects non-integral numbers
  (`Number.isInteger`) instead of passing `1.5` through unchanged, matching
  every other integer site and strict mode.
- `x-mjst` `Date` coercion no longer yields an `Invalid Date`: a value that
  cannot be parsed falls back to the default (required) or `undefined`
  (optional) rather than producing an `instanceof Date` object whose every
  operation is `NaN`.
- A declared property literally named `__proto__` is emitted as a computed key
  (`["__proto__"]:`) so it becomes a real own property instead of triggering
  the object-literal prototype-setter form.

All fixes sit on cold/coercion branches or add a single `===` to a loop already
running a regex test per key, so hot paths are unaffected.
