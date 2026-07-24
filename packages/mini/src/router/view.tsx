import { createHost } from '../internal/create-host'
import { renderChild } from '../internal/render-child'
import type { Route, Router } from './create-router'

/** Props for {@link RouterView}. */
export type RouterViewProps<R extends Route> = {
  /** The router whose `route` signal drives the view. Prop-drilled, mini's charter — `router={router}`. */
  router: Pick<Router<R>, 'route'>
  /**
   * The route key holding the view factory (a `() => HTMLElement`). Defaults to
   * `view`, matching the `{ path, view }` route shape the README uses.
   */
  view?: string
  /** Rendered when nothing matched, or the matched route carries no view. */
  fallback?: () => HTMLElement
}

/**
 * Renders the matched route's view and swaps it on navigation — the first-class
 * outlet that removes the `route().route?.['view'] as …` cast a hand-written
 * render function needs. It reads the view factory off the matched route (under
 * the `view` key by default), mounts it, and tears it down when the route
 * changes, exactly like `<Show>` swaps a branch.
 *
 * Route metadata is opaque to the router, so the view factory is read as
 * `unknown` and guarded before it is called; point `view` at a different key if
 * the route table stores its component elsewhere. A matched route whose `view`
 * is present but not a function throws a readable error rather than letting
 * `renderChild` crash on a non-callable — the router equivalent of `<Dynamic>`'s
 * guard.
 */
export const RouterView = <R extends Route>(props: RouterViewProps<R>): HTMLElement => {
  const host = createHost()
  const key = props.view ?? 'view'
  renderChild(host, () => {
    const factory = props.router.route().route?.[key]
    if (factory !== undefined && typeof factory !== 'function') {
      throw new TypeError(
        `<RouterView> expected route.${key} to be a view factory (() => HTMLElement), but got a ${typeof factory}. ` +
          `Store a function under "${key}", or point view= at the key that holds it.`,
      )
    }
    return (factory as (() => Node) | undefined) ?? props.fallback ?? null
  })
  return host
}
