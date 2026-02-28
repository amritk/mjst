import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Replaces $dynamicRef with $ref in a schema using the provided anchor-to-path map.
 *
 * This creates a deep clone of the schema to avoid mutating the original, then walks
 * the clone and converts any { $dynamicRef: "#meta" } to { $ref: "#/$defs/schema" }
 * (or whatever the dynamicRefMap dictates).
 *
 * Only the direct properties and their nested schemas are walked — this does not need
 * to be infinitely deep because the build system generates separate files for each $def,
 * so each schema is relatively shallow.
 */
export const resolveDynamicRefs = (
  schema: JSONSchema,
  dynamicRefMap: Record<string, string>,
): JSONSchema => {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  // Skip if there are no dynamic refs to resolve
  if (Object.keys(dynamicRefMap).length === 0) {
    return schema
  }

  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>

  const walk = (obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
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
