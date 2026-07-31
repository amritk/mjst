import { decodeSegment } from './decode-segment'
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
 * The candidates for one route *shape* — one method, one segment count —
 * split by what the pattern's first segment demands.
 *
 * `byFirstLiteral` is keyed by that literal and each list already has the
 * `wildcardFirst` routes merged into it **in registration order**, so a lookup
 * is one map get and never a merge. Precomputing that merge is what keeps the
 * behaviour identical: when two routes both match a path the earlier-registered
 * one wins, and that has to hold across the split too — `/{tenant}/settings`
 * registered before `/admin/{page}` still wins `/admin/settings`.
 */
type ShapeBucket = {
  readonly byFirstLiteral: ReadonlyMap<string, readonly CompiledRoute[]>
  readonly wildcardFirst: readonly CompiledRoute[]
}

/**
 * One method's parameterized routes, bucketed by the number of segments an
 * incoming path has.
 *
 * `byCount[n]` holds everything that can match an `n`-segment path: the
 * non-greedy patterns of exactly that length, plus every greedy (`{rest+}`)
 * pattern short enough to swallow the remainder. `longer` covers paths with
 * more segments than the longest pattern registered — only greedy tails can
 * still reach those, so it is exactly the greedy set.
 */
type MethodIndex = {
  readonly byCount: readonly ShapeBucket[]
  readonly longer: ShapeBucket
}

/**
 * The lookup structures derived from a {@link RouteTable}. The table itself is
 * the package's public shape (`createApi` builds it, `RouteTable` is exported),
 * so rather than change it we derive the fast form here once and memoize it —
 * see {@link routeIndex}.
 */
type RouteIndex = {
  /** Static routes as method → normalized path → route. */
  readonly staticByMethod: ReadonlyMap<string, ReadonlyMap<string, CompiledRoute>>
  /** Parameterized routes, bucketed per method. */
  readonly dynamicByMethod: ReadonlyMap<string, MethodIndex>
  /**
   * Normalized static path → the methods serving it, so the 405 `allow` list
   * costs a map get instead of a per-method rescan. The compiled engine emits
   * the same table as `ALLOW_STATIC`.
   */
  readonly staticAllow: ReadonlyMap<string, readonly string[]>
}

/**
 * Route tables are built once at startup and never mutated (hot reload swaps
 * in a whole new `Api`), so keying the derived index off the table object is
 * safe — and weak, so a replaced table takes its index with it.
 */
const ROUTE_INDEXES = new WeakMap<RouteTable, RouteIndex>()

const routeIndex = (table: RouteTable): RouteIndex => {
  const cached = ROUTE_INDEXES.get(table)
  if (cached !== undefined) return cached
  const built = buildRouteIndex(table)
  ROUTE_INDEXES.set(table, built)
  return built
}

/**
 * Looks up a route for a method + path. Static paths hit a nested map (two map
 * gets, no string building); parameterized paths only ever walk candidates of
 * the same shape — same method, same segment count, compatible first segment —
 * so a table of five hundred `/resource/{id}` routes costs about what a table
 * of five does. `method` is expected uppercase, per the {@link ApiRequest}
 * contract.
 */
export const matchRoute = (table: RouteTable, method: string, path: string): RouteMatch | undefined => {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  const index = routeIndex(table)

  const staticRoutes = index.staticByMethod.get(method)
  if (staticRoutes !== undefined) {
    const staticRoute = staticRoutes.get(normalized)
    // Static beats dynamic for the same path, so this returns before any
    // segment walking — '/users/me' never falls through to '/users/{id}'.
    if (staticRoute !== undefined) return { route: staticRoute, params: EMPTY_PARAMS }
  }

  const dynamic = index.dynamicByMethod.get(method)
  if (dynamic === undefined) return undefined

  const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
  for (const route of candidatesFor(dynamic, segments)) {
    const params = matchSegments(route.segments, segments)
    if (params !== undefined) return { route, params }
  }
  return undefined
}

/**
 * The methods that serve `path` other than `exclude` — the `allow` list a 405
 * (or an automatic OPTIONS) answers with.
 *
 * Lives here because it is the same lookup problem as {@link matchRoute}, and
 * because doing it as "run the full matcher once per known method" is what
 * made an unroutable path from a scanner cost several times a real request:
 * every method re-normalized the path, re-split it, and rescanned every
 * parameterized route. Now the static answer is precomputed and the dynamic
 * check reuses one split across all methods.
 */
export const allowedMethods = (table: RouteTable, path: string, exclude: string): string[] => {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  const index = routeIndex(table)

  const allow: string[] = []
  for (const method of index.staticAllow.get(normalized) ?? []) {
    if (method !== exclude) allow.push(method)
  }

  // An all-static API is common enough to be worth not splitting the path for.
  if (index.dynamicByMethod.size === 0) return allow

  const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
  for (const method of table.methods) {
    if (method === exclude || allow.includes(method)) continue
    const dynamic = index.dynamicByMethod.get(method)
    if (dynamic === undefined) continue
    for (const route of candidatesFor(dynamic, segments)) {
      if (matchSegments(route.segments, segments) !== undefined) {
        allow.push(method)
        break
      }
    }
  }
  return allow
}

/**
 * The candidate list for a path of this shape. Paths longer than every
 * registered pattern fall to the greedy-only bucket; a first segment nobody
 * declared as a literal falls to the routes whose first segment is a
 * parameter.
 */
const candidatesFor = (index: MethodIndex, segments: readonly string[]): readonly CompiledRoute[] => {
  const bucket = index.byCount[segments.length] ?? index.longer
  const first = segments[0]
  // The root path has no first segment, and no parameterized pattern is empty,
  // so this only ever hands back an empty list.
  if (first === undefined) return bucket.wildcardFirst
  return bucket.byFirstLiteral.get(first) ?? bucket.wildcardFirst
}

const buildRouteIndex = (table: RouteTable): RouteIndex => {
  const staticByMethod = new Map<string, Map<string, CompiledRoute>>()
  const staticAllow = new Map<string, string[]>()
  for (const route of table.staticRoutes.values()) {
    // Rebuilt from the parsed segments rather than read back out of the
    // table's composite key, so this stays independent of how `createApi`
    // spells that key. Every segment of a static route is a literal, and the
    // root path's empty segment list yields '/' — the same normalization
    // incoming paths get.
    const path = '/' + route.segments.join('/')
    const byPath = staticByMethod.get(route.method) ?? new Map<string, CompiledRoute>()
    byPath.set(path, route)
    staticByMethod.set(route.method, byPath)
    const methods = staticAllow.get(path) ?? []
    methods.push(route.method)
    staticAllow.set(path, methods)
  }

  const dynamicByMethod = new Map<string, MethodIndex>()
  for (const [method, routes] of table.dynamicRoutes) {
    dynamicByMethod.set(method, buildMethodIndex(routes))
  }

  return { staticByMethod, dynamicByMethod, staticAllow }
}

const isGreedy = (route: CompiledRoute): boolean => {
  const tail = route.segments[route.segments.length - 1]
  return typeof tail === 'object' && tail.greedy === true
}

const buildMethodIndex = (routes: readonly CompiledRoute[]): MethodIndex => {
  const longest = routes.reduce((count, route) => Math.max(count, route.segments.length), 0)
  const byCount = Array.from({ length: longest + 1 }, (_unused, count) =>
    // A greedy tail needs at least as many segments as its pattern has and
    // takes everything past that, so it belongs to every count from its own
    // length upwards; a plain pattern matches its exact length only.
    buildShapeBucket(
      routes.filter((route) => (isGreedy(route) ? route.segments.length <= count : route.segments.length === count)),
    ),
  )
  return { byCount, longer: buildShapeBucket(routes.filter(isGreedy)) }
}

/**
 * Splits one shape's candidates by first segment while keeping registration
 * order inside every list: a wildcard-first route joins each literal list it
 * was registered before *and* after, in the position it was registered.
 */
const buildShapeBucket = (routes: readonly CompiledRoute[]): ShapeBucket => {
  const byFirstLiteral = new Map<string, CompiledRoute[]>()
  const wildcardFirst: CompiledRoute[] = []
  for (const route of routes) {
    const first = route.segments[0]
    if (typeof first === 'string') {
      const existing = byFirstLiteral.get(first)
      // A literal seen for the first time inherits every wildcard-first route
      // registered ahead of it, so precedence between the two is preserved.
      if (existing === undefined) byFirstLiteral.set(first, [...wildcardFirst, route])
      else existing.push(route)
    } else {
      wildcardFirst.push(route)
      for (const candidates of byFirstLiteral.values()) candidates.push(route)
    }
  }
  return { byFirstLiteral, wildcardFirst }
}

const matchSegments = (
  pattern: readonly PathSegment[],
  segments: readonly string[],
): Record<string, string> | undefined => {
  // A greedy tail ({name+}) owns the rest of the path — one or more segments,
  // so /files/{path+} matches /files/a but never bare /files.
  const tail = pattern[pattern.length - 1]
  const greedy = typeof tail === 'object' && tail.greedy === true
  if (greedy ? segments.length < pattern.length : pattern.length !== segments.length) return undefined

  let params: Record<string, string> | undefined
  const fixed = greedy ? pattern.length - 1 : pattern.length
  for (let index = 0; index < fixed; index++) {
    const expected = pattern[index]
    const actual = segments[index] ?? ''
    if (typeof expected === 'string') {
      if (expected !== actual) return undefined
    } else if (expected !== undefined) {
      params ??= {}
      params[expected.name] = decodeSegment(actual)
    }
  }
  if (greedy && typeof tail === 'object') {
    params ??= {}
    // Decoded per segment then rejoined, so an encoded '/' inside one segment
    // cannot masquerade as a separator during matching.
    params[tail.name] = segments
      .slice(pattern.length - 1)
      .map(decodeSegment)
      .join('/')
  }
  return params ?? EMPTY_PARAMS
}
