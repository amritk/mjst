import type { CookiesSerializer } from './create-client'

/**
 * Serializes a call's declared cookies onto the `cookie` request header,
 * percent-encoded to mirror the server's per-value decode. Appends to any
 * cookie header an earlier source already set rather than replacing it.
 *
 * Opt-in for the same reason as `buildParamPath`: browsers forbid scripts
 * from setting the `cookie` header, so a browser bundle can never use this —
 * only Node/undici/workers callers register it, via `createClient(contracts,
 * url, { cookies: appendCookies })`.
 */
export const appendCookies: CookiesSerializer = (headers, cookies) => {
  const pairs = Object.entries(cookies)
    .filter(([, value]) => value !== undefined)
    .map(([cookieName, value]) => `${cookieName}=${encodeURIComponent(String(value))}`)
  if (pairs.length === 0) return
  const existing = headers.get('cookie')
  const joined = pairs.join('; ')
  headers.set('cookie', existing === null ? joined : existing + '; ' + joined)
}
