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
 * Characters that must not survive into a filename. Anything outside the
 * identifier characters (plus the `-`/`.` separators the naming scheme already
 * produces) is folded to `-`, because the derived name has to work as three
 * things at once: a path on every filesystem (Windows rejects `:*?"<>|`), an
 * ESM import specifier (`#` opens a URL fragment, so `'./#named.ts'` is
 * unloadable), and a shell-friendly file the user can actually open.
 */
const UNSAFE_FILENAME_CHARS = /[^\p{ID_Continue}.-]+/gu

/**
 * A short, stable suffix for a ref whose name normalizes away to nothing
 * (`#/$defs/`, `#/$defs/..`, `#/$defs/+++`). Without it every such ref would
 * collapse onto the same fallback name and silently share one output file; a
 * ref-derived hash keeps distinct definitions distinct. FNV-1a over code
 * points — no cryptographic claim, just a cheap spread.
 */
const stableSuffix = (ref: string): string => {
  let hash = 0x811c9dc5
  for (const char of ref) {
    hash ^= char.codePointAt(0) as number
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/**
 * Makes a derived name safe to write to disk and to import, and guarantees it
 * is non-empty. Leading and trailing `.`/`-` are stripped so a ref like
 * `#/$defs/..` cannot produce the dot-file `...ts` or a name Windows refuses.
 */
const normalizeFilename = (raw: string, ref: string): string => {
  const cleaned = raw
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
  return cleaned === '' ? `ref-${stableSuffix(ref)}` : cleaned
}

/**
 * Derives a unique kebab-case filename from a URI ref.
 *
 * For a plain URI (no fragment), uses the path segments after the host,
 * stripping version numbers, `.json` extension, and joining with `-`.
 * For a URI with a fragment, appends the fragment's last path segment.
 * A host-only URI (`http://x`) has no path to name the file after, so the host
 * itself is used rather than letting the protocol punctuation leak in.
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
  const parsed = /^https?:\/\/([^/]+)(?:\/(.*))?$/.exec(baseUri)
  const host = parsed?.[1] ?? ''
  const path = parsed?.[2] ?? ''
  const withoutProtocol = parsed ? (path === '' ? host : path) : baseUri
  const withoutExt = withoutProtocol.replace(/\.json$/, '')

  // Drop structural/noise segments:
  // - "definitions" and "$defs" container keys
  // - Version numbers that immediately follow "definitions" (e.g. "3.1.0" in "definitions/3.1.0/channel")
  //   but NOT version numbers in other positions (e.g. "0.5.0" in "bindings/kafka/0.5.0/channel")
  //   since those are needed to disambiguate multiple versions of the same binding
  const rawSegments = withoutExt.split('/')
  const SKIP_KEYS = new Set(['definitions', '$defs'])
  const segments: string[] = []
  for (let i = 0; i < rawSegments.length; i++) {
    const s = rawSegments[i] as string
    if (SKIP_KEYS.has(s)) continue
    // Skip a version segment only if the previous (non-skipped) segment was "definitions"
    const prevRaw = rawSegments[i - 1]
    if (/^\d+\.\d+/.test(s) && prevRaw !== undefined && SKIP_KEYS.has(prevRaw)) continue
    segments.push(s)
  }

  // Join remaining segments, converting to kebab-case and replacing dots with dashes
  const baseName = segments.map((s) => toKebabCase(s).replace(/\./g, '-')).join('-')

  if (!fragment) return baseName

  // Append the last meaningful segment of the fragment, skipping structural keys
  const fragSegments = fragment.split('/').filter((s) => s && !SKIP_KEYS.has(s) && s !== 'properties')
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
 * @param ref - The $ref string
 * @returns The filename without extension
 *
 * @example
 * ```ts
 * refToFilename('#/$defs/contact') // 'contact'
 * refToFilename('#/$defs/server-variable') // 'server-variable'
 * refToFilename('#/definitions/ServerVariable') // 'server-variable'
 * refToFilename('#/definitions/APIKeySecurityScheme') // 'api-key-security-scheme'
 * refToFilename('http://asyncapi.com/definitions/3.1.0/channel.json') // 'channel'
 * refToFilename('#named') // 'named' — a plain `$anchor` ref
 * ```
 */
export const refToFilename = (ref: string): string => {
  // URI ref — derive name from URI path
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return normalizeFilename(uriRefToFilename(ref), ref)
  }

  // Internal ref — extract the last segment after the last /
  const segments = ref.split('/')
  // Non-null assertion is safe here: split always returns at least one element
  let filename = segments[segments.length - 1] as string

  // Normalise PascalCase/camelCase keys (e.g. from draft-07 "definitions") to kebab-case
  if (/[A-Z]/.test(filename)) {
    filename = toKebabCase(filename)
  }

  return normalizeFilename(filename, ref)
}
