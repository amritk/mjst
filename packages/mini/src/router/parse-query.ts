import type { RouteParams } from './match-route'

/**
 * Parses a `?a=1&b=2` search string into a flat record — the reactive `query`
 * dashboards read directly (`route().query.page`). A leading `?` is optional,
 * an empty string yields an empty record, and repeated keys keep the last value
 * (`URLSearchParams` order), matching how a form's last field write wins.
 */
export const parseQuery = (search: string): RouteParams => {
  const params: RouteParams = {}
  const raw = search.startsWith('?') ? search.slice(1) : search
  if (!raw) return params
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value
  return params
}
