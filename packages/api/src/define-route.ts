import type { ResponseContracts, RouteContract } from './types'

/**
 * Declares a route contract. This is an identity function — all the work
 * happens in the type system: the `const` type parameters capture the request
 * and response schemas as literals, and the handler's context and return type
 * are derived from them. `params`, `query`, and `body` arrive in the handler
 * already validated (and coerced from their string transport form), typed via
 * `FromSchema`, and the handler can only return status/body pairs the
 * `responses` map declares.
 *
 * Schemas are plain JSON Schema (Draft 2020-12) written inline. Schemas
 * authored in Zod, TypeBox, Valibot, or Effect can be converted with
 * `@amritk/adapters` first.
 *
 * @example
 * ```typescript
 * const getUser = defineRoute({
 *   method: 'get',
 *   path: '/users/{id}',
 *   request: {
 *     params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
 *   },
 *   responses: {
 *     200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
 *     404: {},
 *   },
 *   handler: ({ params }) => {
 *     // params.id is a number here
 *     return params.id === 1 ? { status: 200, body: { name: 'Ada' } } : { status: 404 }
 *   },
 * })
 * ```
 */
export const defineRoute = <
  const Params = undefined,
  const Query = undefined,
  const Body = undefined,
  const Headers = undefined,
  const Cookies = undefined,
  const Responses extends ResponseContracts = ResponseContracts,
>(
  route: RouteContract<Params, Query, Body, Headers, Cookies, Responses>,
): RouteContract<Params, Query, Body, Headers, Cookies, Responses> => route
