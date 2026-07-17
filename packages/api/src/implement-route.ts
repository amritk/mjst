import type { Contract, ResponseContracts, RouteContract, RouteHandler } from './types'

/**
 * Binds a server handler to a contract declared with `defineContract`,
 * producing the same route shape `defineRoute` builds in one shot. The
 * handler's context and return types are derived from the contract's schema
 * literals, so nothing is retyped — the contract stays the single source of
 * truth and the frontend keeps importing it handler-free.
 *
 * Handlers that need an app context (`createApi({ context })`) bind through
 * `routeImplementer<AppContext>()` instead, the split-workflow counterpart to
 * `routeFactory`.
 *
 * @example
 * ```typescript
 * export const getUserRoute = implementRoute(getUser, ({ params }) =>
 *   params.id === 1 ? { status: 200, body: { name: 'Ada' } } : { status: 404 },
 * )
 * ```
 */
export const implementRoute = <
  const Params = undefined,
  const Query = undefined,
  const Body = undefined,
  const Headers = undefined,
  const Cookies = undefined,
  const Responses extends ResponseContracts = ResponseContracts,
>(
  contract: Contract<Params, Query, Body, Headers, Cookies, Responses>,
  handler: RouteHandler<Params, Query, Body, Headers, Cookies, Responses>,
): RouteContract<Params, Query, Body, Headers, Cookies, Responses> => ({ ...contract, handler })
