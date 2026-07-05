import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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
 */
export const resolveDynamicRefs = (schema: JSONSchema, dynamicRefMap: Record<string, string>): JSONSchema => {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  // Skip if there are no dynamic refs to resolve
  if (Object.keys(dynamicRefMap).length === 0) {
    return schema
  }

  // Cheap read-only pre-scan: most subschemas carry no `$dynamicRef`, so returning
  // the original untouched avoids a full deep clone (and its allocation) on every
  // node of every generator's walk when the document as a whole *does* use them.
  if (!containsDynamicRef(schema)) {
    return schema
  }

  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>

  const walk = (obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null) {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
      return
    }

    const record = obj as Record<string, unknown>

    if ('$dynamicRef' in record && typeof record['$dynamicRef'] === 'string') {
      const resolved = dynamicRefMap[record['$dynamicRef'] as string]
      if (resolved) {
        record['$ref'] = resolved
        delete record['$dynamicRef']
      }
    }

    for (const key in record) {
      walk(record[key])
    }
  }

  walk(clone)
  return clone as JSONSchema
}

/** True if `value` contains a `$dynamicRef` string anywhere in its subtree. */
const containsDynamicRef = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) {
    for (const item of value) if (containsDynamicRef(item)) return true
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof record['$dynamicRef'] === 'string') return true
  for (const key in record) if (containsDynamicRef(record[key])) return true
  return false
}
