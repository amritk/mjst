import { assignKey } from './assign-key'
import { DATA_KEYWORDS, SCHEMA_MAPS } from './build-resource-registry'

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

const fold = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    let changed = false
    const next = node.map((item) => {
      const folded = fold(item)
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
  for (const [key, value] of Object.entries(record)) {
    if (DATA_KEYWORDS.has(key)) {
      assignKey(next, key, value)
      continue
    }
    const folded = SCHEMA_MAPS.has(key) ? foldSchemaMap(value) : fold(value)
    if (folded !== value) changed = true
    assignKey(next, key, folded)
  }

  const type = record['type']
  if (record['nullable'] === true) {
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

/** Folds every value of a name-to-schema map; no key in one is a keyword. */
const foldSchemaMap = (node: unknown): unknown => {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return node
  const record = node as Record<string, unknown>
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(record)) {
    const folded = fold(value)
    if (folded !== value) changed = true
    assignKey(next, name, folded)
  }
  return changed ? next : node
}
