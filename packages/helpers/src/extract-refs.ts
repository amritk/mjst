import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Returns true if a $ref value should be queued for processing.
 *
 * Accepted forms:
 * - Internal: `#/$defs/foo` or `#/definitions/foo`
 * - URI key: `http://example.com/foo.json` (no fragment, or empty fragment)
 * - URI with fragment: `http://example.com/foo.json#/definitions/bar`
 *
 * Excluded:
 * - `#` alone (self-reference, not a standalone definition)
 * - Relative path refs (e.g. `/components/messages/foo`) — these point into
 *   example data in the schema document, not into type definitions
 */
const isResolvableRef = (ref: string): boolean => {
  if (ref === '#') return false
  if (ref.startsWith('#')) return true
  if (ref.startsWith('http://') || ref.startsWith('https://')) return true
  return false
}

/**
 * Extracts all $ref values from a JSON Schema recursively.
 * Returns both internal (`#`-prefixed) and URI refs so the build pipeline
 * can resolve and generate files for all referenced definitions.
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
 *     channel: { $ref: 'http://example.com/channel.json' },
 *   }
 * }
 * const refs = extractRefs(schema)
 * // refs = Set(['#/$defs/contact', 'http://example.com/channel.json'])
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

    if ('$ref' in record && typeof record['$ref'] === 'string' && isResolvableRef(record['$ref'] as string)) {
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
