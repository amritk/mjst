---
'@amritk/generate-parsers': minor
'@amritk/helpers': minor
---

Stop strict parsers accepting what the schema forbids: prototype-inherited
`required`, undiscriminated unions, and `$ref` fragments that were never decoded

Measured against the official JSON Schema Test Suite, strict-mode generation goes
from 1141/1299 to **1180/1299 (90.8%)**. Four defects, all of them cases where the
generated parser said yes to a document the schema says no to — or refused one it
should have taken.

- **`required` compiled to `in`, which walks the prototype chain.** `"toString" in {}`
  is `true`, so `{ "required": ["__proto__", "toString", "constructor"] }` was
  satisfied by an object carrying none of them. `Object.hasOwn` now covers the
  names an object can actually inherit, and plain `in` stays everywhere else so
  ordinary keys keep the form the engine can fold — the same split
  `@amritk/generate-validators` already made. Generated output for ordinary keys is
  byte-identical. Applies to `required`, `dependentRequired`, `dependentSchemas`,
  and `false`-property absence.
- **A `oneOf`/`anyOf`/`allOf` whose branches carry no `type` compiled to a
  pass-through.** `{ "oneOf": [{ "type": "integer" }, { "minimum": 2 }] }` emitted
  `parseRoot = (input) => input`: nothing to discriminate on meant nothing was
  checked, so a value matching *no* branch — or, for `oneOf`, more than one — was
  accepted. Those compositions are now enforced through the existing subschema
  matcher, and only where the flat union check declines, so nothing is checked
  twice and the common discriminated-union path is unchanged.
- **`$ref` fragments were matched literally, never decoded.** `#/$defs/percent%25field`,
  `#/$defs/foo%22bar` and `#/$defs//$defs/` (an empty pointer token) resolved to
  nothing, and generation stopped. Tokens are now percent-decoded before `~1`/`~0`
  unescaping, per token, and empty tokens are significant. Two consequences worth
  knowing: a definition whose name literally contains `%25` must now be written
  `%2525`, and `#/$defs//x` now means the `""` member rather than silently meaning
  `#/$defs/x`. `#/` still means the document root.
- **A boolean `$defs` entry was not a ref target.** `$defs: { bool: true }` is a
  legal definition; the ref graph only named object subschemas, so a `$ref` at it
  resolved to nothing. Boolean entries in a definition map now expand to their
  object equivalents (`true` → `{}`, `false` → `{ not: {} }`) — confined to
  definition maps, because elsewhere `additionalProperties: true` and `{}` generate
  different *types*.

`@amritk/helpers` carries the last two (`resolve-ref`, `walk-ref-graph`) plus the
new `hasOwnCheck`/`missingCheck` emitters in `safe-accessor`.
