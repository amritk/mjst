import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assertSchemaDepth } from './max-schema-depth'
import { isSchemaObject } from './schema-guards'

/** Escapes a JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`. */
const escapeSegment = (segment: string): string =>
  segment.indexOf('~') !== -1 || segment.indexOf('/') !== -1
    ? segment.replace(/~/g, '~0').replace(/\//g, '~1')
    : segment

// Keywords whose values are data, not subschemas — an `$anchor` key inside an
// enum member or example value is instance data and must not register.
const NON_SCHEMA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

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

  const walk = (node: unknown, pointer: string, depth: number): void => {
    assertSchemaDepth(depth, 'buildAnchorMap')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${pointer}/${i}`, depth + 1)
      return
    }

    const record = node as Record<string, unknown>
    for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
      const anchor = record[keyword]
      if (typeof anchor === 'string' && !Object.hasOwn(map, anchor)) map[anchor] = `#${pointer}`
    }

    for (const key of Object.keys(record)) {
      if (NON_SCHEMA_KEYWORDS.has(key)) continue
      walk(record[key], `${pointer}/${escapeSegment(key)}`, depth + 1)
    }
  }

  walk(rootSchema, '', 0)
  return map
}
