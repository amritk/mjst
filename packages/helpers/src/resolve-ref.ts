import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildAnchorMap } from './build-anchor-map'

/**
 * Anchor maps are memoized per root document: `resolveRef` is called once per
 * ref and scanning the whole document for `$anchor` declarations on each call
 * would turn ref resolution quadratic. Schemas are treated as immutable here,
 * and the `WeakMap` drops the entry once the caller releases the document.
 */
const anchorMaps = new WeakMap<object, Record<string, string>>()

const getAnchorMap = (rootSchema: Record<string, unknown>): Record<string, string> => {
  const existing = anchorMaps.get(rootSchema)
  if (existing) return existing
  const map = buildAnchorMap(rootSchema as JSONSchema)
  anchorMaps.set(rootSchema, map)
  return map
}

/**
 * Navigates a JSON Pointer fragment (e.g. `/$defs/foo` or `/definitions/bar`)
 * through a schema object, returning the target or undefined if not found.
 */
const navigatePointer = (pointer: string, schema: Record<string, unknown>): Record<string, unknown> | undefined => {
  const parts = pointer.split('/').filter(Boolean)
  let current = schema

  for (const part of parts) {
    const decodedPart = part.replace(/~1/g, '/').replace(/~0/g, '~')

    // `Object.hasOwn`, not `in`: `#/__proto__` and `#/constructor/prototype`
    // would otherwise walk into `Object.prototype` and hand back a "definition"
    // the document never declared — which the generators then emit a file for.
    if (current && typeof current === 'object' && Object.hasOwn(current, decodedPart)) {
      const next = current[decodedPart as keyof typeof current]
      if (typeof next === 'object' && next !== null) {
        current = next as Record<string, unknown>
      } else {
        return undefined
      }
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Resolves a JSON Schema $ref pointer to the actual schema definition.
 *
 * Supports four ref forms:
 * - Internal pointer: `#/$defs/contact` — navigates the root schema by JSON Pointer
 * - Internal anchor: `#contact` — resolves against the document's `$anchor` /
 *   `$dynamicAnchor` declarations (see {@link buildAnchorMap})
 * - URI key: `http://example.com/foo.json` — looks up the key directly in `$defs`
 * - URI with fragment: `http://example.com/foo.json#/definitions/bar` — looks up
 *   the base URI in `$defs`, then navigates the fragment within that definition
 *
 * @param ref - The $ref string
 * @param rootSchema - The root schema containing the definitions
 * @returns The resolved schema or undefined if not found
 *
 * @example
 * ```ts
 * const rootSchema = {
 *   $defs: {
 *     contact: { type: 'object', properties: { email: { type: 'string' } } },
 *     'http://example.com/server.json': { type: 'object' },
 *   }
 * }
 * resolveRef('#/$defs/contact', rootSchema)
 * resolveRef('http://example.com/server.json', rootSchema)
 * ```
 */
export const resolveRef = (ref: string, rootSchema: Record<string, unknown>): Record<string, unknown> | undefined => {
  // Internal reference: either a JSON Pointer (`#`, `#/$defs/x`) or a plain
  // `$anchor` name (`#contact`). Treating the anchor form as a pointer — which
  // is what happened before — never matched anything, and the caller went on to
  // derive the filename `#contact` from it, so the generated import specifier
  // opened a URL fragment instead of naming a module.
  if (ref.startsWith('#')) {
    const fragment = ref.slice(1)
    if (fragment === '' || fragment.startsWith('/')) return navigatePointer(fragment, rootSchema)

    const pointer = getAnchorMap(rootSchema)[fragment]
    return pointer === undefined ? undefined : navigatePointer(pointer.slice(1), rootSchema)
  }

  // URI ref: may have a fragment (e.g. "http://foo.com/bar.json#/definitions/baz")
  // A trailing bare "#" (e.g. "http://foo.com/schema#") means "the whole document" — treat as no fragment
  const hashIndex = ref.indexOf('#')
  const baseUri = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
  const rawFragment = hashIndex === -1 ? '' : ref.slice(hashIndex + 1)
  const fragment = rawFragment === '' || rawFragment === '/' ? '' : rawFragment

  // Look up the base URI as a key in $defs
  const defs = rootSchema['$defs']
  if (typeof defs !== 'object' || defs === null) return undefined

  const defsRecord = defs as Record<string, unknown>
  const base = defsRecord[baseUri]
  if (typeof base !== 'object' || base === null) return undefined

  // No fragment — return the definition directly
  if (!fragment) return base as Record<string, unknown>

  // Normalize the fragment: draft-07 schemas use `/definitions/` but after
  // upgradeDraft07Schema the key is renamed to `/$defs/`
  const normalizedFragment = fragment.replace(/^\/definitions\//, '/$defs/')

  // Navigate the fragment within the resolved definition
  return navigatePointer(normalizedFragment, base as Record<string, unknown>)
}
