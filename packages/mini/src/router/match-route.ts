/** The parameters captured from a matched route, keyed by their `:name`. */
export type RouteParams = Record<string, string>

/**
 * Matches a route pattern against a concrete pathname, returning the captured
 * params or `null` when the two do not match.
 *
 * The pattern grammar is intentionally tiny — the only two things dashboards
 * reach for:
 * - `:name` captures one path segment into `params.name`.
 * - a trailing `*` captures the entire rest of the path into `params.rest`
 *   (the empty string when nothing follows), which covers nested layouts and
 *   catch-all/404 routes.
 *
 * Everything else must match literally. Leading and trailing slashes are
 * normalised so `/users` and `/users/` are the same route, and captured
 * segments are `decodeURIComponent`-decoded so `%20` and friends arrive
 * readable.
 */
export const matchRoute = (pattern: string, path: string): RouteParams | null => {
  const patternParts = split(pattern)
  const pathParts = split(path)
  const params: RouteParams = {}

  for (let i = 0; i < patternParts.length; i++) {
    const segment = patternParts[i] as string
    if (segment === '*') {
      // A trailing wildcard swallows whatever remains, joined back into a path.
      params['rest'] = pathParts.slice(i).map(decode).join('/')
      return params
    }
    const value = pathParts[i]
    if (value === undefined) return null
    if (segment.startsWith(':')) params[segment.slice(1)] = decode(value)
    else if (segment !== value) return null
  }

  // With no wildcard, a match must consume the path exactly — a longer path is
  // a different, more specific route.
  return patternParts.length === pathParts.length ? params : null
}

/** Splits a path into its non-empty segments, dropping leading/trailing slashes. */
const split = (path: string): string[] => path.split('/').filter((part) => part.length > 0)

/** Decodes a single captured segment, tolerating malformed encodings. */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
