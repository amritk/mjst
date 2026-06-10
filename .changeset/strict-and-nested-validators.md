---
'@amritk/generate-validators': minor
---

Generated validators no longer silently skip checks that the runtime
interpreter performs, closing two correctness gaps:

- **Inline nested objects are validated recursively.** An object schema written
  directly under `properties` (rather than referenced via `$ref`) previously
  only produced an "is an object" shape check; its fields went completely
  unchecked. The generator now recurses to any depth, reporting errors at the
  correct nested JSON Pointer paths, and `$ref`s buried inside inline nested
  objects are collected as imports.
- **`additionalProperties: false` is enforced.** Undeclared keys are now
  rejected with the interpreter's `must NOT have additional properties`
  message, at both the root and nested levels. The known-keys Set is hoisted to
  module scope and the sweep uses an allocation-free `for...in` loop, so the
  generated validators stay at Ajv-compiled speed.

Also fixes array item error paths, which duplicated the property name
(`/tags/tags/0` instead of `/tags/0`), and updates the README benchmark tables:
the old throughput numbers were inflated by the skipped nested checks.

Inputs that previously passed validation against strict or nested schemas may
now (correctly) fail.
