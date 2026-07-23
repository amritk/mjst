import type { Contract, ResponseContracts, RouteContract, RouteGuard, RouteHandler } from './types'

/**
 * How a route is implemented: either a bare {@link RouteHandler}, or an object
 * pairing the handler with authorization {@link RouteGuard}s that run before it.
 * The object form is what protects an endpoint —
 * `implementRoute(contract, { guards: [requireSession], handler })` — while the
 * bare-function form stays the terse default for public routes.
 */
export type RouteImplementation<Params, Query, Body, Headers, Cookies, Responses extends ResponseContracts, Context> =
  | RouteHandler<Params, Query, Body, Headers, Cookies, Responses, Context>
  | {
      readonly guards?: readonly RouteGuard<Params, Query, Body, Headers, Cookies, Responses, Context>[]
      readonly handler: RouteHandler<Params, Query, Body, Headers, Cookies, Responses, Context>
    }

/**
 * Binds a server handler (and optional guards) to a contract declared with
 * `defineContract`, producing the same route shape `defineRoute` builds in one
 * shot. The handler's context and return types are derived from the contract's
 * schema literals, so nothing is retyped — the contract stays the single source
 * of truth and the frontend keeps importing it handler-free.
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
 *
 * // Guarded: the guard runs before the handler and can only deny with a
 * // status the contract declares.
 * export const getProfileRoute = implementRoute(getProfile, {
 *   guards: [requireSession],
 *   handler: ({ context }) => ({ status: 200, body: toProfile(context.session) }),
 * })
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
  implementation: RouteImplementation<Params, Query, Body, Headers, Cookies, Responses, undefined>,
): RouteContract<Params, Query, Body, Headers, Cookies, Responses> =>
  typeof implementation === 'function'
    ? { ...contract, handler: implementation }
    : // Conditional spread keeps `guards` absent (not `undefined`) when omitted,
      // which `exactOptionalPropertyTypes` requires of the optional field.
      {
        ...contract,
        ...(implementation.guards !== undefined ? { guards: implementation.guards } : {}),
        handler: implementation.handler,
      }
