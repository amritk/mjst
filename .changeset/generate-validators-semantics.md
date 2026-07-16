---
"@amritk/generate-validators": patch
---

Fix several cases where a generated validator diverged from the runtime interpreter (its oracle), accepting invalid input or emitting broken code:

- A `required` property whose schema is empty (`{}`) or boolean `true` now gets a presence check — previously the key could be missing and still validate.
- A root scalar schema that combines a `type` with a combinator (e.g. `{ type: 'string', not: {…} }` or `{ type: 'number', minimum: 10, allOf: [{ maximum: 100 }] }`) now enforces the `type` and its sibling constraints instead of only the combinator branch.
- `items: false` with no `prefixItems` now requires an empty array instead of being silently ignored.
- A `$ref` reached only through a draft-07 schema-form `dependencies` entry is now imported, so the generated file no longer calls an undefined `validateX`.
