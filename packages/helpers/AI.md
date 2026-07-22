# @amritk/helpers — notes for AI coding agents

Shared schema-traversal, codegen, and runtime utilities for the mjst ecosystem,
each published as its own subpath so consumers import only what they need. Full
reference is [README.md](./README.md).

> Pre-alpha: internal ecosystem package — most users never import it directly.
> APIs change in **minor** versions.

## Minimal example

```ts
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { isObjectSchema, hasProperties } from '@amritk/helpers/schema-guards'

const node = resolveRef('#/$defs/info', rootSchema) // (ref, root); undefined on miss

if (node && isObjectSchema(node) && hasProperties(node)) {
  for (const [name, property] of Object.entries(node.properties)) {
    // …
  }
}
```

## Gotchas — where agents fail

1. **No barrel — import per subpath.** `@amritk/helpers/resolve-ref`, NOT
   `@amritk/helpers`. The subpath is the exact kebab-case filename with no `.ts`.
2. **`resolveRef(ref, rootSchema)`** takes the ref first, root second, handles
   JSON-pointer `$ref`s only, and returns `undefined` on a miss (no throw) —
   guard the result.
3. **Two similar guards:** `isSchemaObject` narrows to a non-boolean schema;
   `isObjectSchema` narrows to a `type: object` schema. Don't confuse them.
4. **Some modules are copied verbatim into generated output** (`is-object`,
   `safe-accessor`, `validate-array`, `validate-record`) — intentionally
   dependency-free and minimal, not general-purpose validators.

Notable subpaths: `/resolve-ref`, `/extract-refs`, `/schema-guards`,
`/ref-to-name`, `/ref-to-filename`, `/upgrade-draft07-schema`,
`/generate-type-definition`, `/is-object`. Install: `bun add @amritk/helpers`.
