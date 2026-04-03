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
export const toKebabCase = (value: string): string =>
  value
    // Collapse known mixed-case acronyms before splitting so they stay together
    .replace(/OAuth/g, 'Oauth')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase()

/**
 * Derives a unique kebab-case filename from a URI ref.
 *
 * For a plain URI (no fragment), uses the path segments after the host,
 * stripping version numbers, `.json` extension, and joining with `-`.
 * For a URI with a fragment, appends the fragment's last path segment.
 *
 * @example
 * ```ts
 * uriRefToFilename('http://asyncapi.com/definitions/3.1.0/channel.json')
 * // 'channel'
 * uriRefToFilename('http://asyncapi.com/bindings/kafka/0.5.0/channel.json')
 * // 'kafka-channel-binding'
 * uriRefToFilename('http://asyncapi.com/bindings/sns/0.1.0/channel.json#/definitions/queue')
 * // 'sns-channel-queue'
 * ```
 */
const uriRefToFilename = (uri: string): string => {
  const hashIndex = uri.indexOf('#')
  const baseUri = hashIndex === -1 ? uri : uri.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '' : uri.slice(hashIndex + 1)

  // Strip protocol + host, remove .json extension
  const withoutProtocol = baseUri.replace(/^https?:\/\/[^/]+\//, '')
  const withoutExt = withoutProtocol.replace(/\.json$/, '')

  // Drop structural/noise segments: version numbers (e.g. "3.1.0"), "definitions", "$defs"
  const SKIP_SEGMENTS = new Set(['definitions', '$defs'])
  const segments = withoutExt
    .split('/')
    .filter((s) => !SKIP_SEGMENTS.has(s) && !/^\d+\.\d+/.test(s))

  // Join remaining segments and convert to kebab-case
  const baseName = segments.map(toKebabCase).join('-')

  if (!fragment) return baseName

  // Append the last meaningful segment of the fragment, skipping structural keys
  const fragSegments = fragment.split('/').filter((s) => s && !SKIP_SEGMENTS.has(s) && s !== 'properties')
  const fragLast = fragSegments[fragSegments.length - 1]
  if (!fragLast) return baseName

  return `${baseName}-${toKebabCase(fragLast)}`
}

/**
 * Converts a JSON Schema $ref to a filename.
 *
 * Handles three ref forms:
 * - Internal `#/$defs/contact` → `contact`
 * - Internal `#/definitions/ServerVariable` → `server-variable`
 * - URI `http://example.com/definitions/3.1.0/channel.json` → `channel`
 * - URI with fragment `http://example.com/channel.json#/definitions/queue` → `channel-queue`
 *
 * Removes the "-or-reference" suffix if present.
 *
 * @param ref - The $ref string
 * @returns The filename without extension
 *
 * @example
 * ```ts
 * refToFilename('#/$defs/contact') // 'contact'
 * refToFilename('#/$defs/server-variable') // 'server-variable'
 * refToFilename('#/$defs/callbacks-or-reference') // 'callbacks'
 * refToFilename('#/definitions/ServerVariable') // 'server-variable'
 * refToFilename('#/definitions/APIKeySecurityScheme') // 'api-key-security-scheme'
 * refToFilename('http://asyncapi.com/definitions/3.1.0/channel.json') // 'channel'
 * ```
 */
export const refToFilename = (ref: string): string => {
  // URI ref — derive name from URI path
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return uriRefToFilename(ref)
  }

  // Internal ref — extract the last segment after the last /
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
