import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { entersSchemaMap, isDataPosition } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { readKey } from './read-key'

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

  const traverse = (obj: unknown, depth: number, inSchemaMap = false): void => {
    assertSchemaDepth(depth, 'extractRefs')
    if (typeof obj !== 'object' || obj === null) {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item, depth + 1, inSchemaMap)
      }
      return
    }

    const record = obj as Record<string, unknown>

    if (!inSchemaMap && typeof readKey(record, '$ref') === 'string' && isResolvableRef(record['$ref'] as string)) {
      refs.add(record['$ref'] as string)
    }

    // A `$ref` inside a `default`/`enum`/`const`/`example(s)` value belongs to
    // the value, not the schema — collecting it marked a definition reachable
    // that nothing references, and made `walkRefGraph` fail the build outright
    // when the ref-shaped literal named nothing.
    for (const key of Object.keys(record)) {
      if (isDataPosition(key, inSchemaMap)) continue
      traverse(record[key], depth + 1, entersSchemaMap(key, inSchemaMap))
    }
  }

  traverse(schema, 0)
  return refs
}
