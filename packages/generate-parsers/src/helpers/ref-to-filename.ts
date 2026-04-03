/**
 * Converts a PascalCase or camelCase string to kebab-case.
 * Handles consecutive uppercase sequences (e.g. "APIKey" → "api-key") and
 * known mixed-case acronyms like "OAuth" that would otherwise split incorrectly.
 *
 * @example
 * ```ts
 * toKebabCase('ServerVariable') // 'server-variable'
 * toKebabCase('APIKeySecurityScheme') // 'api-key-security-scheme'
 * toKebabCase('OAuthFlows') // 'oauth-flows'
 * toKebabCase('already-kebab') // 'already-kebab'
 * ```
 */
const toKebabCase = (value: string): string =>
  value
    // Collapse known mixed-case acronyms before splitting so they stay together
    .replace(/OAuth/g, 'Oauth')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase()

/**
 * Converts a JSON Schema $ref to a filename.
 * Extracts the last segment of the ref path and normalises it to kebab-case.
 * Handles both kebab-case ($defs style) and PascalCase (definitions style) keys.
 * Removes the "-or-reference" suffix if present.
 *
 * @param ref - The $ref string (e.g., "#/$defs/contact" or "#/definitions/ServerVariable")
 * @returns The filename without extension (e.g., "contact" or "server-variable")
 *
 * @example
 * ```ts
 * refToFilename('#/$defs/contact') // 'contact'
 * refToFilename('#/$defs/server-variable') // 'server-variable'
 * refToFilename('#/$defs/external-documentation') // 'external-documentation'
 * refToFilename('#/$defs/callbacks-or-reference') // 'callbacks'
 * refToFilename('#/definitions/ServerVariable') // 'server-variable'
 * refToFilename('#/definitions/APIKeySecurityScheme') // 'api-key-security-scheme'
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

  // Normalise PascalCase/camelCase keys (e.g. from draft-07 "definitions") to kebab-case
  if (/[A-Z]/.test(filename)) {
    filename = toKebabCase(filename)
  }

  return filename
}
