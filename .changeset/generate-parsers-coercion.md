---
"@amritk/generate-parsers": patch
---

Fix cases where the coercing parser "repaired" input into a value that was still invalid, and a prototype-pollution hazard in case-insensitive enum coercion:

- **`integer` coercion** now yields a whole number (or the default) instead of leaving a non-integral value like `1.5` in place — the repaired value previously still failed the schema's integrality check. This matches the root-level integer parser.
- **Array-form `type`** (e.g. `["string","null"]`) now derives its default from the first listed type, so a missing/mistyped required value coerces to a valid member instead of `undefined` (which violated both `required` and the declared type).
- **`caseInsensitive` enum coercion** now uses a `Map` rather than a plain object. A folded key that collides with an inherited member (`constructor`, `toString`, `__proto__`, …) no longer skips the member at generation time or returns an `Object.prototype` value at runtime; it resolves to the fallback (or the correct member).
