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
   JSON-pointer `$ref`s, plain `$anchor` names (`#named`), and URI keys in
   `$defs`, and returns `undefined` on a miss (no throw) — guard the result.
3. **`walkRefGraph` throws, it does not degrade.** An unresolvable `$ref`, a
   `$dynamicRef` with no anchor, and two definitions that reduce to one filename
   or one type name all fail generation. Each of those used to warn and carry on,
   which shipped TypeScript that either did not compile or bound to the wrong
   type. `$id` base-URI scoping is *resolved*, not refused — `normalizeRefScopes`
   rewrites every ref to a document-root pointer first — and only the residue the
   spec calls unresolvable (a fragment ref naming nothing in its own resource)
   still throws, via `assertIdScopes`.
4. **Two similar guards:** `isSchemaObject` narrows to a non-boolean schema;
   `isObjectSchema` narrows to a `type: object` schema. Don't confuse them.
5. **Some modules are copied verbatim into generated output** (`is-object`,
   `safe-accessor`, `validate-array`, `validate-record`) — intentionally
   dependency-free and minimal, not general-purpose validators.

Notable subpaths: `/resolve-ref`, `/extract-refs`, `/schema-guards`,
`/ref-to-name`, `/ref-to-filename`, `/upgrade-draft07-schema`,
`/walk-ref-graph`, `/generate-type-definition`, `/is-object`. Install: `bun add @amritk/helpers`.
