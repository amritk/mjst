import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { DATA_KEYWORDS, entersSchemaMap, isDataPosition } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { readKey } from './read-key'

/**
 * Replaces $dynamicRef with $ref in a schema using the provided anchor-to-path map.
 *
 * This creates a deep clone of the schema to avoid mutating the original, then walks
 * the clone and converts any { $dynamicRef: "#meta" } to { $ref: "#/$defs/schema" }
 * (or whatever the dynamicRefMap dictates).
 *
 * Walks both object properties and array elements, so a `$dynamicRef` nested
 * inside a keyword whose value is an array of subschemas (`allOf`, `anyOf`,
 * `oneOf`, `prefixItems`, …) is rewritten too. The build system generates a
 * separate file per `$def`, so each schema walked here is relatively shallow.
 *
 * A `$dynamicRef` the map cannot place is a hard error. Leaving it in place was
 * the old behaviour, and it was the quiet kind of broken: the type generator
 * then named the type after the anchor itself, emitting a reference to a type
 * no file exports — and for the conventional anchor name `node` that reference
 * resolves against the DOM's `Node` interface under most app tsconfigs, so the
 * build succeeds with the wrong type instead of failing. A pointer form
 * (`$dynamicRef: "#/$defs/x"`) names no anchor at all, so it degrades to a plain
 * `$ref`, matching 2020-12's rule that a dynamic ref with no dynamic anchor to
 * bind to behaves statically.
 */
export const resolveDynamicRefs = (schema: JSONSchema, dynamicRefMap: Record<string, string>): JSONSchema => {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  // Cheap read-only pre-scan: most subschemas carry no `$dynamicRef`, so returning
  // the original untouched avoids a full deep clone (and its allocation) on every
  // node of every generator's walk when the document as a whole *does* use them.
  if (!containsDynamicRef(schema, 0)) {
    return schema
  }

  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>

  const walk = (obj: unknown, depth: number, inSchemaMap = false): void => {
    assertSchemaDepth(depth, 'resolveDynamicRefs')
    if (typeof obj !== 'object' || obj === null) {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1, inSchemaMap)
      return
    }

    const record = obj as Record<string, unknown>

    const dynamicRef = inSchemaMap ? undefined : readKey(record, '$dynamicRef')
    if (typeof dynamicRef === 'string') {
      // `readKey`, not a bare index: the map is keyed by author-chosen anchor
      // names, so `$dynamicRef: "toString"` otherwise resolved to a `Function`
      // and was written into `$ref` in place of the "unresolvable" error.
      const resolved = readKey(dynamicRefMap, dynamicRef) ?? (dynamicRef.startsWith('#/') ? dynamicRef : undefined)
      if (resolved === undefined) {
        throw new Error(
          `Unresolvable $dynamicRef "${dynamicRef}": no $dynamicAnchor named "${dynamicRef.replace(/^#/, '')}" is ` +
            'declared anywhere in the document. Declare the anchor, or point a plain $ref at the definition instead.',
        )
      }
      record['$ref'] = resolved
      delete record['$dynamicRef']
    }

    // A `$dynamicRef` inside a `default`/`enum`/`example(s)` value is part of
    // that value: rewriting it changed the literal the author wrote (key
    // deleted, `$ref` added), and an unmatched one failed the build outright.
    for (const key of Object.keys(record)) {
      if (isDataPosition(key, inSchemaMap)) continue
      walk(record[key], depth + 1, entersSchemaMap(key, inSchemaMap))
    }
  }

  walk(clone, 0)
  return clone as JSONSchema
}

/** True if `value` contains a `$dynamicRef` string anywhere in its subtree. */
const containsDynamicRef = (value: unknown, depth: number): boolean => {
  assertSchemaDepth(depth, 'resolveDynamicRefs')
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) {
    for (const item of value) if (containsDynamicRef(item, depth + 1)) return true
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof readKey(record, '$dynamicRef') === 'string') return true
  for (const key of Object.keys(record)) {
    if (DATA_KEYWORDS.has(key)) continue
    if (containsDynamicRef(record[key], depth + 1)) return true
  }
  return false
}
