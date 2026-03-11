/**
 * Converts a JSON Schema $ref to a filename.
 * Extracts the last segment of the ref path and uses it as-is (kebab-case).
 * Removes the "-or-reference" suffix if present.
 *
 * @param ref - The $ref string (e.g., "#/$defs/contact" or "#/$defs/server-variable")
 * @returns The filename without extension (e.g., "contact" or "server-variable")
 *
 * @example
 * ```ts
 * refToFilename('#/$defs/contact') // 'contact'
 * refToFilename('#/$defs/server-variable') // 'server-variable'
 * refToFilename('#/$defs/external-documentation') // 'external-documentation'
 * refToFilename('#/$defs/callbacks-or-reference') // 'callbacks'
 * ```
 */
export const refToFilename = (ref: string): string => {
  // Extract the last segment after the last /
  const segments = ref.split('/')
  // Non-null assertion is safe here: split always returns at least one element
  let filename = segments[segments.length - 1] as string

  // Remove "-or-reference" suffix if present
  if (filename.endsWith('-or-reference')) {
    filename = filename.slice(0, -13) // Remove "-or-reference" (13 characters)
  }

  return filename
}
