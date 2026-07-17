import { coercePrimitive } from './coerce-primitive'
import type { Coercion } from './types'

/**
 * Builds the object a route's cookies schema validates from the raw `cookie`
 * header. Only declared names are kept — a browser sends every cookie it
 * holds (analytics, ads, other apps on the domain), and none of that should
 * reach validation. Values are unquoted (RFC 6265 allows DQUOTE-wrapped
 * values) and percent-decoded, matching what cookie middleware ecosystems
 * (cookie-parser, hono/cookie) hand applications; malformed escapes fall
 * back to the raw text rather than failing the request.
 *
 * Exported so `compileToModule` output can import it — both engines must
 * parse the header identically.
 */
export const buildCookiesObject = (
  header: string | undefined,
  names: ReadonlySet<string>,
  coercions: ReadonlyMap<string, Coercion>,
): Record<string, unknown> => {
  const cookies: Record<string, unknown> = {}
  if (header === undefined || header === '') return cookies

  const length = header.length
  let start = 0
  while (start < length) {
    let end = header.indexOf(';', start)
    if (end === -1) end = length
    const eq = header.indexOf('=', start)
    // A segment without '=' is not a valid cookie-pair; skip it like the
    // parsers everyone already runs behind do.
    if (eq !== -1 && eq < end) {
      const name = header.slice(start, eq).trim()
      if (names.has(name)) {
        let value = header.slice(eq + 1, end).trim()
        if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1)
        }
        const decoded = decodeCookieValue(value)
        const coercion = coercions.get(name)
        cookies[name] = coercion === 'number' || coercion === 'boolean' ? coercePrimitive(decoded, coercion) : decoded
      }
    }
    start = end + 1
  }
  return cookies
}

const decodeCookieValue = (value: string): string => {
  if (!value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
