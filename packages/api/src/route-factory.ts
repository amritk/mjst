import type { ResponseContracts, RouteContract } from './types'

/**
 * Binds `defineRoute` to an app context type, so every route declared through
 * the returned function sees `context` typed as what the app's
 * `createApi({ context })` factory produces. The factory and this type
 * parameter are the two halves of one contract — keep them in one module so
 * they cannot drift:
 *
 * @example
 * ```typescript
 * // app-context.ts
 * export type AppContext = { db: Database; session: Session | null }
 * export const defineAppRoute = routeFactory<AppContext>()
 * export const createContext = ({ env }: ContextFactoryInput): AppContext => ({ ... })
 *
 * // routes.ts
 * export const listUsers = defineAppRoute({
 *   method: 'get',
 *   path: '/users',
 *   responses: { 200: { body: { type: 'array' } } },
 *   handler: async ({ context }) => ({ status: 200, body: await context.db.select()... }),
 * })
 * ```
 */
export const routeFactory = <Context>() => {
  return <
    const Params = undefined,
    const Query = undefined,
    const Body = undefined,
    const Responses extends ResponseContracts = ResponseContracts,
  >(
    route: RouteContract<Params, Query, Body, Responses, Context>,
  ): RouteContract<Params, Query, Body, Responses, Context> => route
}
