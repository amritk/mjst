/**
 * Navigates a JSON Pointer fragment (e.g. `/$defs/foo` or `/definitions/bar`)
 * through a schema object, returning the target or undefined if not found.
 */
const navigatePointer = (
  pointer: string,
  schema: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const parts = pointer.split('/').filter(Boolean)
  let current = schema

  for (const part of parts) {
    const decodedPart = part.replace(/~1/g, '/').replace(/~0/g, '~')

    if (current && typeof current === 'object' && decodedPart in current) {
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
 * Supports three ref forms:
 * - Internal: `#/$defs/contact` — navigates the root schema by JSON Pointer
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
  // Internal reference: navigate from root by JSON Pointer
  if (ref.startsWith('#')) {
    return navigatePointer(ref.slice(1), rootSchema)
  }

  // URI ref: may have a fragment (e.g. "http://foo.com/bar.json#/definitions/baz")
  const hashIndex = ref.indexOf('#')
  const baseUri = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '' : ref.slice(hashIndex + 1)

  // Look up the base URI as a key in $defs
  const defs = rootSchema['$defs']
  if (typeof defs !== 'object' || defs === null) return undefined

  const defsRecord = defs as Record<string, unknown>
  const base = defsRecord[baseUri]
  if (typeof base !== 'object' || base === null) return undefined

  // No fragment — return the definition directly
  if (!fragment) return base as Record<string, unknown>

  // Navigate the fragment within the resolved definition
  return navigatePointer(fragment, base as Record<string, unknown>)
}
