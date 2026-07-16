import type { PathSegment } from './types'

/**
 * Parses an OpenAPI-style path pattern (`/users/{id}/posts`) into segments the
 * matcher can walk. Runs once per route at startup, so it validates strictly
 * and throws on malformed patterns — failing fast here beats a route that
 * silently never matches.
 *
 * The root path `/` parses to zero segments. A trailing slash is dropped so
 * `/users/` and `/users` declare the same route, matching how the matcher
 * normalizes incoming paths.
 */
export const parsePathPattern = (path: string): readonly PathSegment[] => {
  if (!path.startsWith('/')) {
    throw new Error(`Route path must start with '/': '${path}'`)
  }
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (normalized === '/') return []
  return normalized
    .slice(1)
    .split('/')
    .map((segment) => {
      if (segment.startsWith('{') && segment.endsWith('}')) {
        const name = segment.slice(1, -1)
        if (name === '' || name.includes('{') || name.includes('}')) {
          throw new Error(`Invalid path parameter '${segment}' in '${path}'`)
        }
        return { name }
      }
      // A parameter owns its whole segment; '/files/{name}.json' style partial
      // captures are not supported (and would not round-trip into OpenAPI).
      if (segment.includes('{') || segment.includes('}')) {
        throw new Error(`Partial path parameters are not supported: '${segment}' in '${path}'`)
      }
      if (segment === '') {
        throw new Error(`Empty path segment in '${path}'`)
      }
      return segment
    })
}
