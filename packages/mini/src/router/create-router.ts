import type { ReadonlySignal } from '../signals'
import { signal } from '../signals'
import { matchRoute, type RouteParams } from './match-route'

/**
 * One route definition. `path` is a {@link matchRoute} pattern; every other key
 * is opaque to the router and carried through on the match — put the view
 * factory (or any per-route metadata) there and read it off `route().route`.
 */
export type Route = { path: string } & Record<string, unknown>

/**
 * How the router reads and writes the URL.
 * - `history` uses `location.pathname` and the History API — real URLs, needs a
 *   server (or dev server) that serves the app for every path.
 * - `hash` uses the `#…` fragment — no server config, safe for static hosting.
 */
export type RouterMode = 'history' | 'hash'

/** Options for {@link createRouter}. */
export type RouterOptions<R extends Route> = {
  /** The route table, tried top to bottom; the first pattern that matches wins. */
  routes: readonly R[]
  /** URL strategy. Defaults to `history`. */
  mode?: RouterMode
  /**
   * A path prefix every route lives under (history mode only), e.g. `/app`. It
   * is stripped before matching and prepended on navigation, so route patterns
   * stay written relative to the mount point.
   */
  base?: string
}

/** The current location, matched against the route table — the reactive value dashboards render from. */
export type RouteState<R extends Route> = {
  /** The active pathname, base-stripped and normalised. */
  path: string
  /** The query string including its leading `?`, or `''` when there is none. */
  search: string
  /** The query string parsed into a record (last value wins on repeats) — read `query.page` directly. */
  query: RouteParams
  /** Params captured from the matched route's pattern. */
  params: RouteParams
  /** The matched route definition, or `null` when nothing matched (render a 404). */
  route: R | null
}

/** Options for a single {@link Router.navigate} call. */
export type NavigateOptions = {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean
}

/** A live client-side router. */
export type Router<R extends Route> = {
  /** The reactive current location — read it in a binding to re-render on navigation. */
  route: ReadonlySignal<RouteState<R>>
  /** Navigate to a path (relative to `base`); pass `{ replace: true }` to avoid a new history entry. */
  navigate: (to: string, options?: NavigateOptions) => void
  /** Detach the router's location listener. Call when the app unmounts. */
  stop: () => void
}

/**
 * Creates a client-side router: it reads the current URL, matches it against
 * the route table into a reactive `route` signal, and keeps that signal in sync
 * as the user navigates (via `navigate`, back/forward, or an in-page hash
 * change). The single-view widget never imports this; the dashboards mount one
 * router and render `router.route()`.
 *
 * The router attaches its `popstate`/`hashchange` listener immediately, so it
 * is live the moment it is created; `stop()` detaches it.
 */
export const createRouter = <R extends Route>(options: RouterOptions<R>): Router<R> => {
  const mode = options.mode ?? 'history'
  const base = options.base ?? ''

  const read = (): RouteState<R> => resolve(options.routes, currentLocation(mode, base))
  const route = signal<RouteState<R>>(read())

  // The browser fires `popstate` for back/forward but NOT for pushState, and
  // `hashchange` for fragment edits; `navigate` therefore updates the signal
  // itself in history mode while letting the event drive it in hash mode.
  const onChange = (): void => route(read())
  const event = mode === 'hash' ? 'hashchange' : 'popstate'
  window.addEventListener(event, onChange)

  const navigate = (to: string, navigateOptions?: NavigateOptions): void => {
    const replace = navigateOptions?.replace ?? false
    if (mode === 'hash') {
      // Setting the hash triggers `hashchange`, which refreshes the signal —
      // except when `to` equals the current hash, where the browser fires no
      // event (re-clicking the active link). `replace` needs the History API
      // because assigning `location.hash` always pushes. Either way, refresh the
      // signal directly so navigation is never silently dropped.
      if (replace) window.history.replaceState(null, '', `#${to}`)
      else window.location.hash = to
      route(read())
    } else {
      const url = base + to
      if (replace) window.history.replaceState(null, '', url)
      else window.history.pushState(null, '', url)
      route(read())
    }
  }

  return { route, navigate, stop: () => window.removeEventListener(event, onChange) }
}

/** Reads the current path+search from the browser for the active mode. */
const currentLocation = (mode: RouterMode, base: string): { path: string; search: string } => {
  if (mode === 'hash') {
    const raw = window.location.hash.slice(1) || '/'
    const q = raw.indexOf('?')
    return q === -1 ? { path: raw, search: '' } : { path: raw.slice(0, q), search: raw.slice(q) }
  }
  const path = stripBase(window.location.pathname, base)
  return { path, search: window.location.search }
}

/** Removes the configured base prefix from a pathname before matching. */
const stripBase = (pathname: string, base: string): string => {
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length)
    return rest.startsWith('/') || rest === '' ? rest || '/' : pathname
  }
  return pathname
}

/** Matches a location against the route table, returning the assembled state. */
const resolve = <R extends Route>(routes: readonly R[], location: { path: string; search: string }): RouteState<R> => {
  const query = parseQuery(location.search)
  for (const route of routes) {
    const params = matchRoute(route.path, location.path)
    if (params) return { path: location.path, search: location.search, query, params, route }
  }
  return { path: location.path, search: location.search, query, params: {}, route: null }
}

/** Parses a `?a=1&b=2` search string into a flat record; repeated keys keep the last value. */
const parseQuery = (search: string): RouteParams => {
  const params: RouteParams = {}
  const raw = search.startsWith('?') ? search.slice(1) : search
  if (!raw) return params
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value
  return params
}
