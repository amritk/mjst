import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// The pointer built here is handed back as a `$ref` fragment and
// percent-decoded on the way in, so it has to be escaped by the same
// function that contract is defined by. A local copy omitted the `%`
// escape, which left an anchor under a key like `a%2Fb` unresolvable.
import { escapePointerSegment, schemaChildren } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { isSchemaObject } from './schema-guards'

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
 * The document root is included, mapping to the pointer `#`. That is the
 * canonical recursive-tree idiom (`{ $id: '.../tree', $dynamicAnchor: 'node',
 * items: { $dynamicRef: '#node' } }`), and leaving it out meant the ref had no
 * target at all: the type generator fell back to the anchor's *name*, so
 * `#node` became the type `Node` — never generated, never imported, and under
 * the `DOM` lib silently bound to the DOM `Node` interface instead of failing.
 * `walkRefGraph` turns the `#` pointer into the root's own generated file.
 *
 * @example
 * // Given a schema with $defs.schema having $dynamicAnchor: "meta"
 * buildDynamicRefMap(rootSchema)
 * // Returns: { "#meta": "#/$defs/schema" }
 */
export const buildDynamicRefMap = (rootSchema: JSONSchema): Record<string, string> => {
  const map: Record<string, string> = {}
  if (!isSchemaObject(rootSchema)) return map

  const walk = (node: unknown, pointer: string, depth: number, inSchemaMap: boolean): void => {
    assertSchemaDepth(depth, 'buildDynamicRefMap')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${pointer}/${i}`, depth + 1, false)
      return
    }

    const record = node as Record<string, unknown>
    const anchor = record['$dynamicAnchor']
    if (typeof anchor === 'string' && !(`#${anchor}` in map)) {
      map[`#${anchor}`] = `#${pointer}`
    }

    for (const child of schemaChildren(record, inSchemaMap)) {
      walk(child.value, `${pointer}/${escapePointerSegment(child.key)}`, depth + 1, child.inSchemaMap)
    }
  }

  walk(rootSchema, '', 0, false)
  return map
}
