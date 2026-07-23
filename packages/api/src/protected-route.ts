import type {
  AnyGuardBundle,
  Contract,
  GuardContextOf,
  MergedGuardResponses,
  ResponseContract,
  ResponseContracts,
  RouteContract,
  RouteHandler,
  Simplify,
} from './types'

/**
 * Binds a handler and a set of {@link GuardBundle}s to a contract, **deriving
 * the guards' denial statuses** — you never re-declare the 401/403 on the
 * route. Each guard's `responses` merge into the contract's, so the returned
 * {@link RouteContract} documents (and validates) exactly the statuses it can
 * actually answer: the handler's own, plus every guard's. The guards run in
 * order before the handler, first denial winning — identical to the plain
 * `guards` field, because that is exactly what this produces. The result is an
 * ordinary route, so both engines run it unchanged.
 *
 * The app `Context` is inferred from the guards (build them with a
 * `guardFactory<AppContext>()` and it flows straight through), and a guard can
 * only deny with a status it declared, so the merge can never document a
 * response the guard cannot actually produce.
 *
 * Note the browser boundary: the *route* carries the merged responses, but a
 * `defineContract` a frontend imports for `createClient` does not — spread
 * `guardResponses(...)` into that contract when the native client needs the
 * status too.
 *
 * @example
 * ```typescript
 * export const getProfile = protectedRoute(
 *   { method: 'get', path: '/profile', responses: { 200: { body: profileSchema } } },
 *   [requireSession],
 *   ({ context }) => ({ status: 200, body: toProfile(context.session.user) }),
 * )
 * // getProfile.responses is { 200, 401 } — the 401 came from requireSession.
 * ```
 */
export const protectedRoute = <
  const Params = undefined,
  const Query = undefined,
  const Body = undefined,
  const Headers = undefined,
  const Cookies = undefined,
  const Responses extends ResponseContracts = ResponseContracts,
  const Guards extends readonly AnyGuardBundle[] = readonly AnyGuardBundle[],
>(
  contract: Contract<Params, Query, Body, Headers, Cookies, Responses>,
  guards: Guards,
  // The handler is typed against the contract's *own* responses, not the merged
  // set: it returns its declared statuses, the guards return theirs. Keeping the
  // handler's reply type a plain `Responses` (rather than a computed
  // intersection) is also what preserves its contextual typing — `status: 200`
  // stays the literal instead of widening to `number`.
  handler: RouteHandler<Params, Query, Body, Headers, Cookies, Responses, GuardContextOf<Guards>>,
): RouteContract<
  Params,
  Query,
  Body,
  Headers,
  Cookies,
  Simplify<Responses & MergedGuardResponses<Guards>>,
  GuardContextOf<Guards>
> => {
  const responses: Record<number, ResponseContract> = { ...(contract.responses as Record<number, ResponseContract>) }
  for (const guard of guards) {
    for (const [status, response] of Object.entries(guard.responses)) {
      // The route's own declaration wins over a guard's for a shared status —
      // the contract is authoritative, the guard only fills gaps.
      responses[Number(status)] ??= response as ResponseContract
    }
  }
  return {
    ...contract,
    responses,
    guards: guards.map((guard) => guard.guard),
    handler,
  } as unknown as RouteContract<
    Params,
    Query,
    Body,
    Headers,
    Cookies,
    Simplify<Responses & MergedGuardResponses<Guards>>,
    GuardContextOf<Guards>
  >
}
