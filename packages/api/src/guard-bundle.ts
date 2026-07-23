import type { AnyGuardBundle, GuardBundle, MergedGuardResponses, ResponseContract, ResponseContracts } from './types'

/**
 * Declares a guard that carries its own denial response — an identity function
 * whose `const` type parameter captures the `responses` literal so
 * `protectedRoute` (and `guardResponses`) can merge it. Annotate the guard's
 * `context` with `ContextGuardInput<AppContext>` to type the app context, or
 * bind it once with {@link guardFactory} to skip the annotation.
 *
 * @example
 * ```typescript
 * const requireSession = defineGuard({
 *   responses: { 401: { body: errorSchema } },
 *   guard: (ctx: ContextGuardInput<AppContext>) =>
 *     ctx.context.session ? undefined : { status: 401, body: { error: 'unauthorized' } },
 * })
 * ```
 */
export const defineGuard = <const GResponses extends ResponseContracts, Context = unknown>(
  bundle: GuardBundle<GResponses, Context>,
): GuardBundle<GResponses, Context> => bundle

/**
 * Binds {@link defineGuard} to an app context type — the guard counterpart to
 * `routeFactory` / `routeImplementer`. Every guard built through the returned
 * function sees `context` typed as the app's `createApi({ context })` factory
 * produces, so the check reads `ctx.context.session` without an annotation.
 *
 * @example
 * ```typescript
 * // app-context.ts — one binding for the whole app
 * export const defineAppGuard = guardFactory<AppContext>()
 *
 * // guards.ts
 * export const requireSession = defineAppGuard({
 *   responses: { 401: { body: errorSchema } },
 *   guard: (ctx) => (ctx.context.session ? undefined : { status: 401, body: { error: 'unauthorized' } }),
 * })
 * ```
 */
export const guardFactory = <Context>() => {
  return <const GResponses extends ResponseContracts>(
    bundle: GuardBundle<GResponses, Context>,
  ): GuardBundle<GResponses, Context> => bundle
}

/**
 * The merged response fragment a set of guards contributes — spread it into a
 * browser-shared `defineContract` so the native `createClient` is typed for the
 * statuses the guards can deny with (the server route derives them via
 * {@link protectedRoute}, but the pure contract the client reads has no guards
 * of its own). Merging is idempotent, so re-declaring a status the contract
 * already has is harmless.
 *
 * @example
 * ```typescript
 * export const getProfileContract = defineContract({
 *   method: 'get',
 *   path: '/profile',
 *   responses: { 200: { body: profileSchema }, ...guardResponses(requireSession) },
 * })
 * ```
 */
export const guardResponses = <const Guards extends readonly AnyGuardBundle[]>(
  ...guards: Guards
): MergedGuardResponses<Guards> => {
  const merged: Record<number, ResponseContract> = {}
  for (const guard of guards) {
    for (const [status, response] of Object.entries(guard.responses)) {
      // First declaration of a status wins, matching protectedRoute's merge so
      // the two never disagree on a shared status.
      merged[Number(status)] ??= response
    }
  }
  return merged as MergedGuardResponses<Guards>
}
