/**
 * `@amritk/mini/router` — a small client-side router for the dashboards
 * (history and hash modes). It matches the URL against a route table into a
 * reactive `route` signal, provides `navigate` and a `<Link>` that intercepts
 * plain clicks, and attaches nothing to the `.` entry: the single-view widget
 * never imports it, so its bytes stay out of that bundle.
 *
 * Composition is explicit — `<Link>` takes `router.navigate` as a prop rather
 * than reading an ambient context, matching mini's prop-drilling charter.
 */
export type {
  NavigateOptions,
  Route,
  Router,
  RouterMode,
  RouterOptions,
  RouteState,
} from './create-router'
export { createRouter } from './create-router'
export type { LinkProps } from './link'
export { Link } from './link'
export type { RouteParams } from './match-route'
export { matchRoute } from './match-route'
