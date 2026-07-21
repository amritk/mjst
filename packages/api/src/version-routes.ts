import type { AnyRouteContract } from './types'

/** Normalizes a version prefix to a leading slash with no trailing slash: `v1` → `/v1`. */
const normalizePrefix = (prefix: string): string => {
  let value = prefix.startsWith('/') ? prefix : `/${prefix}`
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value
}

/**
 * URI-prefix API versioning — the `/v1`, `/v2` convention Django, Rails,
 * NestJS, and Laravel all support first-class. Returns copies of the given
 * route contracts with `prefix` prepended to each `path`, so one set of
 * handlers can be mounted under several versions, or a stable set kept while a
 * next version diverges. Only the path changes; every other contract field
 * (schemas, handler, OpenAPI metadata) is carried through untouched.
 *
 * Register the result like any other routes. Because the prefix lands in the
 * path, it also flows into the OpenAPI document and typed clients.
 *
 * @example
 * ```typescript
 * const api = createApi({
 *   routes: [
 *     ...versionRoutes('/v1', [listUsers, getUser]),
 *     ...versionRoutes('/v2', [listUsersV2, getUser]), // getUser unchanged across versions
 *   ],
 * })
 * ```
 */
export const versionRoutes = (prefix: string, routes: readonly AnyRouteContract[]): AnyRouteContract[] => {
  const normalized = normalizePrefix(prefix)
  return routes.map((route) => ({ ...route, path: `${normalized}${route.path}` }))
}
