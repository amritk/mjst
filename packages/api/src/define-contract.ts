import type { Contract, ResponseContracts } from './types'

/**
 * Declares a route contract with **no handler** — pure data. This is the
 * browser-safe half of the contract/handler split: a frontend imports the
 * contract (for `createClient`) without pulling in a single line of server
 * code, while the server binds the implementation with `implementRoute`.
 *
 * Like `defineRoute`, this is an identity function whose `const` type
 * parameters capture the schema literals, so everything derived from the
 * contract — the handler's context, the client's parameter and reply types —
 * stays exact.
 *
 * @example
 * ```typescript
 * // contracts.ts — imported by both server and browser
 * export const getUser = defineContract({
 *   method: 'get',
 *   path: '/users/{id}',
 *   request: {
 *     params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
 *   },
 *   responses: {
 *     200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
 *     404: {},
 *   },
 * })
 *
 * // routes.ts — server only
 * export const getUserRoute = implementRoute(getUser, ({ params }) =>
 *   params.id === 1 ? { status: 200, body: { name: 'Ada' } } : { status: 404 },
 * )
 * ```
 */
export const defineContract = <
  const Params = undefined,
  const Query = undefined,
  const Body = undefined,
  const Headers = undefined,
  const Cookies = undefined,
  const Responses extends ResponseContracts = ResponseContracts,
>(
  contract: Contract<Params, Query, Body, Headers, Cookies, Responses>,
): Contract<Params, Query, Body, Headers, Cookies, Responses> => contract
