import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// The pointer built here is handed back as a `$ref` fragment and
// percent-decoded on the way in, so it has to be escaped by the same
// function that contract is defined by. A local copy omitted the `%`
// escape, which left an anchor under a key like `a%2Fb` unresolvable.
import { escapePointerSegment, schemaChildren } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { isSchemaObject } from './schema-guards'

/**
 * Maps every `$anchor` name declared in a document to the JSON Pointer of the
 * subschema that declares it, so a plain-name ref (`$ref: "#named"`) can be
 * resolved.
 *
 * `$anchor` is a core 2020-12 keyword, but the resolver only ever understood
 * JSON Pointer fragments — so `#named` navigated the pointer `named`, found
 * nothing, and the ref silently produced an unloadable `'./#named.ts'` import.
 * `$dynamicAnchor` names are collected too: 2020-12 says a `$dynamicAnchor`
 * also behaves as a plain `$anchor`, so a static `$ref` is allowed to target
 * one (only `$dynamicRef` gets the late-binding treatment, which
 * {@link buildDynamicRefMap} handles separately).
 *
 * The whole document is scanned — an anchor may sit anywhere — and the first
 * occurrence in document order wins, matching how `buildDynamicRefMap` binds a
 * name to a single document-global target. The root itself can declare an
 * anchor; it maps to the pointer `#`.
 *
 * @example
 * ```ts
 * // $defs.address carries `$anchor: "addr"`
 * buildAnchorMap(rootSchema) // { addr: '#/$defs/address' }
 * ```
 */
export const buildAnchorMap = (rootSchema: JSONSchema): Record<string, string> => {
  // Anchor names come straight from the document, so a null-prototype object is
  // what keeps `$anchor: "__proto__"` a normal entry (rather than a prototype
  // assignment) and `$anchor: "toString"` a miss (rather than an inherited hit).
  const map = Object.create(null) as Record<string, string>
  if (!isSchemaObject(rootSchema)) return map

  const walk = (node: unknown, pointer: string, depth: number, inSchemaMap: boolean): void => {
    assertSchemaDepth(depth, 'buildAnchorMap')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${pointer}/${i}`, depth + 1, inSchemaMap)
      return
    }

    const record = node as Record<string, unknown>
    for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
      const anchor = record[keyword]
      if (typeof anchor === 'string' && !Object.hasOwn(map, anchor)) map[anchor] = `#${pointer}`
    }

    for (const child of schemaChildren(record, inSchemaMap)) {
      walk(child.value, `${pointer}/${escapePointerSegment(child.key)}`, depth + 1, child.inSchemaMap)
    }
  }

  walk(rootSchema, '', 0, false)
  return map
}
