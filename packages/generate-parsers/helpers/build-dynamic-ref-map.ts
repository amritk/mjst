import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { isSchemaObject } from '#type-guards/schema-guards'

/**
 * Builds a map of $dynamicRef anchor values to their corresponding $ref paths.
 *
 * JSON Schema 2020-12 uses $dynamicAnchor and $dynamicRef for late-binding references.
 * In the OpenAPI spec, $dynamicAnchor: "meta" on the schema definition allows properties
 * like media-type.schema to reference it via $dynamicRef: "#meta".
 *
 * This function scans all $defs for entries with $dynamicAnchor and builds a lookup
 * so we can convert $dynamicRef values to concrete $ref paths.
 *
 * @example
 * // Given a schema with $defs.schema having $dynamicAnchor: "meta"
 * buildDynamicRefMap(rootSchema)
 * // Returns: { "#meta": "#/$defs/schema" }
 */
export const buildDynamicRefMap = (rootSchema: JSONSchema): Record<string, string> => {
  const map: Record<string, string> = {}

  if (!isSchemaObject(rootSchema) || !('$defs' in rootSchema)) {
    return map
  }

  const defs = rootSchema.$defs as Record<string, unknown>

  for (const [key, value] of Object.entries(defs)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      '$dynamicAnchor' in value &&
      typeof (value as Record<string, unknown>)['$dynamicAnchor'] === 'string'
    ) {
      const anchor = (value as Record<string, unknown>)['$dynamicAnchor'] as string
      map[`#${anchor}`] = `#/$defs/${key}`
    }
  }

  return map
}
