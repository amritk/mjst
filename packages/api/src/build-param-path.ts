import type { PathParamsBuilder } from './create-client'

/**
 * Fills a contract's path template. Plain parameters are fully encoded; a
 * greedy `{name+}` value is encoded per segment so its slashes survive as
 * path structure — the inverse of the server's per-segment decode.
 *
 * Opt-in on purpose: `createClient` only needs this when a contract path
 * declares `{param}` segments, so apps with static paths skip these bytes
 * entirely. Register it via `createClient(contracts, url, { pathParams:
 * buildParamPath })`.
 */
export const buildParamPath: PathParamsBuilder = (pattern, params) =>
  pattern.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const greedy = rawName.endsWith('+')
    const key = greedy ? rawName.slice(0, -1) : rawName
    const value = params?.[key]
    if (value === undefined) throw new Error(`Missing path parameter '${key}' for '${pattern}'`)
    const text = String(value)
    if (!greedy) {
      assertNotDotSegment(text, key, pattern)
      return encodeURIComponent(text)
    }
    const segments = text.split('/')
    for (const segment of segments) assertNotDotSegment(segment, key, pattern)
    return segments.map(encodeURIComponent).join('/')
  })

/**
 * Rejects the two segment values a URL cannot actually carry: `.` and `..`.
 *
 * `encodeURIComponent` leaves both untouched (dots are unreserved), so
 * `getUser({ params: { id: '..' } })` builds `/users/..` and the URL parser
 * then removes the segment *before the request is sent* — the call silently
 * hits `/`, not the endpoint the contract named. Failing loudly beats a
 * request that quietly went somewhere else.
 *
 * Greedy tails get the same treatment, per segment, even though `..` looks
 * plausible in a file path. There is no encoding that survives: WHATWG URL
 * normalizes `%2e%2e` and `.%2e` as dot segments too, so a literal `..` path
 * component simply cannot be transmitted. A `..` here is therefore always a
 * traversal the caller did not intend to send, never a directory name — and
 * a client that silently rewrote its own request URL would be the worse
 * outcome. Callers who really want traversal semantics should resolve the
 * path themselves before handing it over.
 */
const assertNotDotSegment = (segment: string, key: string, pattern: string): void => {
  if (segment === '.' || segment === '..') {
    throw new Error(
      `Path parameter '${key}' for '${pattern}' cannot be '${segment}': the URL parser removes that segment, which would send the request to a different path`,
    )
  }
}
