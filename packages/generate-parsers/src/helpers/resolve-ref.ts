/**
 * Resolves a JSON Schema $ref pointer to the actual schema definition.
 * Supports internal references (starting with #) using JSON Pointer syntax.
 *
 * @param ref - The $ref string (e.g., "#/$defs/contact" or "#/components/schemas/User")
 * @param rootSchema - The root schema containing the definitions
 * @returns The resolved schema or undefined if not found
 *
 * @example
 * ```ts
 * const rootSchema = {
 *   $defs: {
 *     contact: { type: 'object', properties: { email: { type: 'string' } } }
 *   }
 * }
 * const resolved = resolveRef('#/$defs/contact', rootSchema)
 * ```
 */
export const resolveRef = (ref: string, rootSchema: Record<string, unknown>): Record<string, unknown> | undefined => {
  // Only handle internal references for now
  if (!ref.startsWith('#')) {
    return undefined
  }

  // Remove the leading # and split by /
  const parts = ref.slice(1).split('/').filter(Boolean)

  // Navigate through the schema
  let current = rootSchema

  for (const part of parts) {
    // Decode URI components (e.g., ~0 = ~, ~1 = /)
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
