import type { RouteImplementation } from './implement-route'
import type { Contract, ResponseContracts, RouteContract } from './types'

/**
 * Binds `implementRoute` to an app context type — the split-workflow
 * counterpart to `routeFactory`. Every handler bound through the returned
 * function sees `context` typed as what the app's `createApi({ context })`
 * factory produces, while the contracts themselves stay handler-free and
 * browser-safe. Guards bound this way see the same typed context, so a shared
 * `requireSession` can read `context.context.session`.
 *
 * @example
 * ```typescript
 * // app-context.ts
 * export const implementAppRoute = routeImplementer<AppContext>()
 *
 * // routes.ts — server only; contracts.ts stays pure data
 * export const getProfileRoute = implementAppRoute(getProfile, {
 *   guards: [requireSession],
 *   handler: ({ context }) => ({ status: 200, body: toProfile(context.session) }),
 * })
 * ```
 */
export const routeImplementer = <Context>() => {
  return <
    const Params = undefined,
    const Query = undefined,
    const Body = undefined,
    const Headers = undefined,
    const Cookies = undefined,
    const Responses extends ResponseContracts = ResponseContracts,
  >(
    contract: Contract<Params, Query, Body, Headers, Cookies, Responses>,
    implementation: RouteImplementation<Params, Query, Body, Headers, Cookies, Responses, Context>,
  ): RouteContract<Params, Query, Body, Headers, Cookies, Responses, Context> =>
    typeof implementation === 'function'
      ? { ...contract, handler: implementation }
      : // Conditional spread keeps `guards` absent (not `undefined`) when
        // omitted, which `exactOptionalPropertyTypes` requires.
        {
          ...contract,
          ...(implementation.guards !== undefined ? { guards: implementation.guards } : {}),
          handler: implementation.handler,
        }
}
