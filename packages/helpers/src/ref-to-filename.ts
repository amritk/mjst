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
 * Keys that hold definitions rather than being one. A segment is dropped from a
 * derived name when it is one of these, and a segment that *follows* one is a
 * definition's own name.
 */
const CONTAINER_SEGMENTS = new Set(['$defs', 'definitions', 'properties'])

/**
 * The parts of a JSON Pointer that name something, outermost first.
 *
 * The last one is always kept — it is what the ref is about. An earlier one is
 * kept only when a container key introduced it, which is what separates a
 * genuinely nested definition (`#/$defs/user/$defs/meta`, where `user` names one)
 * from a path that merely runs through some object keys on its way in
 * (`#/components/schemas/UserProfile`, where `components` and `schemas` name
 * nothing and the ref is simply about `UserProfile`).
 */
const pointerNameParts = (pointer: string): string[] => {
  const segments = pointer.split('/').filter((segment) => segment !== '')
  const named = segments
    .map((segment, index) => ({ segment, nested: index > 0 && CONTAINER_SEGMENTS.has(segments[index - 1] as string) }))
    .filter(({ segment }) => !CONTAINER_SEGMENTS.has(segment))

  return named.filter((part, index) => part.nested || index === named.length - 1).map(({ segment }) => segment)
}

/**
 * Converts a JSON Schema $ref to a filename.
 *
 * The name is built from every part of the ref that names something: the base
 * URI a relative ref points at, then the pointer's own definition names. For the
 * refs almost every document writes — `#/$defs/contact`,
 * `#/components/schemas/UserProfile`, `#named` — there is exactly one, and the
 * name is what it has always been.
 *
 * Deriving it from the whole ref is what makes the name a *pure function of the
 * ref*, and that is load-bearing rather than tidy. Two definitions in different
 * parents (`#/$defs/user/$defs/meta` and `#/$defs/order/$defs/meta`) or in
 * different embedded resources (`first#/$defs/stuff` and `second#/$defs/stuff`)
 * are an ordinary shape in a real document, and naming both after their last
 * segment made them one file — so generation refused rather than emit a silently
 * wrong type. Resolving that by *renaming* whichever was reached second would
 * need every emitter to agree on the walk order, since each turns a `$ref` into
 * an import name on its own; deriving a distinct name from the ref itself means
 * they agree without having to coordinate at all.
 *
 * Handles these ref forms:
 * - Internal `#/$defs/contact` → `contact`
 * - Internal `#/definitions/ServerVariable` → `server-variable`
 * - Nested `#/$defs/user/$defs/meta` → `user-meta`
 * - Relative-base `second#/$defs/stuff` → `second-stuff`
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
 * refToFilename('#/definitions/APIKeySecurityScheme') // 'api-key-security-scheme'
 * refToFilename('#/components/schemas/UserProfile') // 'user-profile'
 * refToFilename('#/$defs/user/$defs/meta') // 'user-meta'
 * refToFilename('second#/$defs/stuff') // 'second-stuff'
 * refToFilename('http://asyncapi.com/definitions/3.1.0/channel.json') // 'channel'
 * refToFilename('#named') // 'named' — a plain `$anchor` ref
 * ```
 */
export const refToFilename = (ref: string): string => {
  // URI ref — derive name from URI path
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return normalizeFilename(uriRefToFilename(ref), ref)
  }

  const hashIndex = ref.indexOf('#')
  const base = hashIndex === -1 ? '' : ref.slice(0, hashIndex)
  const pointer = hashIndex === -1 ? ref : ref.slice(hashIndex + 1)

  // A relative base names a document, so it loses its extension the same way a
  // URI ref's does — `a.json#/$defs/t` is `a-t`, not `a.json-t`.
  const baseParts = base
    .replace(/\.json$/, '')
    .split('/')
    .filter((segment) => segment !== '')
  const parts = [...baseParts, ...pointerNameParts(pointer)]

  // Normalise PascalCase/camelCase keys (e.g. from draft-07 "definitions") to kebab-case
  return normalizeFilename(parts.map((part) => (/[A-Z]/.test(part) ? toKebabCase(part) : part)).join('-'), ref)
}
