import type { CompiledRoute, PathSegment, RouteTable } from './types'

/**
 * A successful lookup: the compiled route plus the raw (string) path
 * parameters captured from the URL.
 */
export type RouteMatch = {
  readonly route: CompiledRoute
  readonly params: Readonly<Record<string, string>>
}

/**
 * Shared by every match without parameters so the common static-route hit
 * allocates nothing. Frozen because it is handed to user handlers.
 */
const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({})

/**
 * Looks up a route for a method + path. Static paths hit a flat map (one
 * string concat, one map get); only parameterized routes pay for a segment
 * scan, and only after splitting the path once. `method` is expected
 * uppercase, per the {@link ApiRequest} contract.
 */
export const matchRoute = (table: RouteTable, method: string, path: string): RouteMatch | undefined => {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

  const staticRoute = table.staticRoutes.get(method + ' ' + normalized)
  if (staticRoute !== undefined) return { route: staticRoute, params: EMPTY_PARAMS }

  const candidates = table.dynamicRoutes.get(method)
  if (candidates === undefined) return undefined

  const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
  for (const route of candidates) {
    const params = matchSegments(route.segments, segments)
    if (params !== undefined) return { route, params }
  }
  return undefined
}

const matchSegments = (
  pattern: readonly PathSegment[],
  segments: readonly string[],
): Record<string, string> | undefined => {
  if (pattern.length !== segments.length) return undefined
  let params: Record<string, string> | undefined
  for (let index = 0; index < pattern.length; index++) {
    const expected = pattern[index]
    const actual = segments[index] ?? ''
    if (typeof expected === 'string') {
      if (expected !== actual) return undefined
    } else if (expected !== undefined) {
      params ??= {}
      params[expected.name] = decodeSegment(actual)
    }
  }
  return params ?? EMPTY_PARAMS
}

/**
 * Percent-decodes a captured parameter. Literal segments are compared raw (a
 * route pattern should not contain characters that need encoding), but a
 * captured value like `/users/ada%40example.com` should reach the handler
 * decoded. Malformed sequences fall back to the raw text rather than turning
 * the whole request into a 500.
 */
const decodeSegment = (segment: string): string => {
  if (!segment.includes('%')) return segment
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
