import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Extracts all $ref values from a JSON Schema recursively.
 * Only returns internal references (starting with #).
 *
 * @param schema - The JSON Schema to extract refs from
 * @returns A Set of unique ref strings found in the schema
 *
 * @example
 * ```ts
 * const schema = {
 *   type: 'object',
 *   properties: {
 *     contact: { $ref: '#/$defs/contact' },
 *     server: { $ref: '#/$defs/server' }
 *   }
 * }
 * const refs = extractRefs(schema)
 * // refs = Set(['#/$defs/contact', '#/$defs/server'])
 * ```
 */
export const extractRefs = (schema: JSONSchema): Set<string> => {
  const refs = new Set<string>()

  const traverse = (obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null) {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item)
      }
      return
    }

    const record = obj as Record<string, unknown>

    // Check if this object has a $ref property
    // Skip specification-extensions — it is not a standalone type; its semantics
    // (Record<`x-${string}`, unknown>) are inlined directly into the generated type.
    if (
      '$ref' in record &&
      typeof record['$ref'] === 'string' &&
      (record['$ref'] as string).startsWith('#') &&
      record['$ref'] !== '#/$defs/specification-extensions'
    ) {
      refs.add(record['$ref'] as string)
    }

    // Recursively traverse all properties using for...in to avoid intermediate array allocation
    for (const key in record) {
      traverse(record[key])
    }
  }

  traverse(schema)
  return refs
}
