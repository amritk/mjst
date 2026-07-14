import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { isSchemaObject } from './schema-guards'

/** Escapes a JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`. */
const escapeSegment = (segment: string): string =>
  segment.indexOf('~') !== -1 || segment.indexOf('/') !== -1
    ? segment.replace(/~/g, '~0').replace(/\//g, '~1')
    : segment

// Keywords whose values are data, not subschemas — a `$dynamicAnchor` key inside
// an enum member or example value is instance data and must not register.
const NON_SCHEMA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

/**
 * Builds a map of $dynamicRef anchor values to their corresponding $ref paths.
 *
 * JSON Schema 2020-12 uses $dynamicAnchor and $dynamicRef for late-binding references.
 * In the OpenAPI spec, $dynamicAnchor: "meta" on the schema definition allows properties
 * like media-type.schema to reference it via $dynamicRef: "#meta".
 *
 * The whole document is scanned — a `$dynamicAnchor` may sit anywhere, not just
 * on a direct `$defs` entry — and each anchor maps to the JSON Pointer of the
 * subschema that declares it. When the same anchor name appears more than once,
 * the first occurrence in document order wins, matching how the resolvers bind
 * a name to a single document-global target.
 *
 * @example
 * // Given a schema with $defs.schema having $dynamicAnchor: "meta"
 * buildDynamicRefMap(rootSchema)
 * // Returns: { "#meta": "#/$defs/schema" }
 */
export const buildDynamicRefMap = (rootSchema: JSONSchema): Record<string, string> => {
  const map: Record<string, string> = {}
  if (!isSchemaObject(rootSchema)) return map

  const walk = (node: unknown, pointer: string): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${pointer}/${i}`)
      return
    }

    const record = node as Record<string, unknown>
    const anchor = record['$dynamicAnchor']
    // The document root is skipped: mapping it would rewrite `$dynamicRef` to
    // `$ref: "#"`, a self-reference the file-per-definition generators cannot
    // name an output file for. Every nested subschema gets a real pointer.
    if (pointer !== '' && typeof anchor === 'string' && !(`#${anchor}` in map)) {
      map[`#${anchor}`] = `#${pointer}`
    }

    for (const key of Object.keys(record)) {
      if (NON_SCHEMA_KEYWORDS.has(key)) continue
      walk(record[key], `${pointer}/${escapeSegment(key)}`)
    }
  }

  walk(rootSchema, '')
  return map
}
