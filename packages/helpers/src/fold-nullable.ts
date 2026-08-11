import { assignKey } from './assign-key'
import { schemaChildren } from './build-resource-registry'

/**
 * Rewrites OpenAPI 3.0's `nullable: true` into the JSON Schema form the
 * generators already enforce: a `null` member of the node's `type`.
 *
 * OpenAPI 3.0 has no `type: [...]` — it spells "or null" as a sibling boolean.
 * Every generator here reads `type`, so an unfolded document produced parsers
 * that rejected `null` outright (strict) or coerced it to a default (non-strict)
 * while the schema declared it valid. Folding once, at the document level, means
 * no downstream path needs to know the keyword exists.
 *
 * A node with `nullable: true` but no `type` is left alone: there is no type
 * list to extend, and OpenAPI 3.0 ignores keywords alongside a `$ref` anyway.
 * The `nullable` key itself is kept so the type generator can still widen the
 * emitted TypeScript with `| null`.
 *
 * Returns the input unchanged (same reference) when the document contains no
 * `nullable: true`, so the common case allocates nothing.
 */
export const foldNullable = <T>(schema: T): T => {
  const folded = fold(schema)
  return folded as T
}

const fold = (node: unknown, inSchemaMap = false): unknown => {
  if (Array.isArray(node)) {
    let changed = false
    const next = node.map((item) => {
      const folded = fold(item, inSchemaMap)
      if (folded !== item) changed = true
      return folded
    })
    return changed ? next : node
  }

  if (typeof node !== 'object' || node === null) return node

  const record = node as Record<string, unknown>
  let changed = false
  const next: Record<string, unknown> = {}

  // Own keys, and a guarded write: a bare `for…in` walks the prototype chain,
  // and `next[key] = …` on a `__proto__` property drops it from the output.
  //
  // At a schema node the keys are keywords, so `enum`/`const`/`default`/
  // `examples` mark instance data: an object under one is a value the schema
  // describes rather than a schema, and folding into it rewrote the value —
  // a schema-shaped `default` came back with its `type` changed, handed to
  // consumers as the author's own. Inside a `properties`-style map the keys are
  // names instead, so the same word carries no keyword meaning there.
  // Everything is copied through first, then `schemaChildren` decides which
  // children are schemas to fold into. Keys it does not yield are instance
  // data, which keeps their values exactly as the author wrote them — and
  // sourcing that rule from the shared generator is what stops this walker
  // drifting from its five siblings.
  for (const [key, value] of Object.entries(record)) assignKey(next, key, value)
  for (const child of schemaChildren(record, inSchemaMap)) {
    const folded = fold(child.value, child.inSchemaMap)
    if (folded !== child.value) changed = true
    assignKey(next, child.key, folded)
  }

  const type = Object.hasOwn(record, 'type') ? record['type'] : undefined
  // Own keys only, and only at a schema node: inside a name-to-schema map,
  // `nullable` is a name. A polluted `Object.prototype.nullable` would
  // otherwise fold every node in the document, so every generated parser
  // accepted `null` where the schema forbids it.
  if (!inSchemaMap && Object.hasOwn(record, 'nullable') && record['nullable'] === true) {
    if (typeof type === 'string' && type !== 'null') {
      next['type'] = [type, 'null']
      changed = true
    } else if (Array.isArray(type) && !type.includes('null')) {
      next['type'] = [...type, 'null']
      changed = true
    }
  }

  return changed ? next : node
}
