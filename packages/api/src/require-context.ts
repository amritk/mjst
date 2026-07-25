import type { ContextGuardInput, RouteReplyValue } from './types'

/**
 * Builds a reusable {@link RouteGuard} from a predicate over the request
 * context and the reply to send when it fails. It is the one-liner most auth
 * guards reduce to — resolve the session in the context factory, then gate on
 * it here:
 *
 * ```typescript
 * // A guard written once, attached to any route that declares its 401.
 * export const requireSession = requireContext(
 *   (ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null,
 *   { status: 401, body: { error: 'unauthorized' } },
 * )
 *
 * // Roles, feature flags — same shape, a different predicate.
 * export const requireAdmin = requireContext(
 *   (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.user.role === 'admin',
 *   { status: 403, body: { error: 'forbidden' } },
 * )
 *
 * // Attached to a security scheme, the predicate also receives the scopes the
 * // requirement asked for — so one guard covers every scope combination the
 * // OpenAPI document advertises.
 * export const requireScopes = requireContext(
 *   (ctx: ContextGuardInput<AppContext>, scopes) =>
 *     scopes.every((scope) => ctx.context.session?.scopes.includes(scope)),
 *   { status: 403, body: { error: 'insufficient_scope' } },
 * )
 * ```
 *
 * The `scopes` argument is the requirement's value list — `['billing:write']`
 * for `security: [{ oauth2: ['billing:write'] }]` — and an empty array for a
 * guard used as a plain route guard, so a predicate may simply ignore it.
 *
 * The predicate may be sync or async (a returned promise is awaited); returning
 * `true` passes the request to the next guard or the handler, `false` denies it
 * with `denied`. Because `denied`'s type flows through, attaching the guard to a
 * route whose `responses` do not declare that status is a compile error — the
 * same guarantee inline guards get. For a denial reply that varies per request
 * (naming the missing scope, say), write a plain guard function instead; this
 * helper deliberately keeps the reply a constant so its type stays exact.
 */
export const requireContext = <const Denied extends RouteReplyValue, Context = unknown>(
  allow: (context: ContextGuardInput<Context>, scopes: readonly string[]) => boolean | Promise<boolean>,
  denied: Denied,
): ((
  context: ContextGuardInput<Context>,
  scopes?: readonly string[],
) => Denied | undefined | Promise<Denied | undefined>) => {
  const guard = (context: ContextGuardInput<Context>, scopes: readonly string[] = NO_SCOPES) => {
    const verdict = allow(context, scopes)
    // A plain boolean stays fully synchronous — no promise is allocated on the
    // common in-process check (a session already on the context).
    if (typeof verdict === 'boolean') return verdict ? undefined : denied
    return verdict.then((ok) => (ok ? undefined : denied))
  }
  denialStatuses.set(guard, denied.status)
  return guard
}

/** Shared empty scope list, so the no-scopes call path allocates nothing. */
const NO_SCOPES: readonly string[] = Object.freeze([])

/**
 * The status each {@link requireContext} guard denies with. `secureRoutes`
 * reads it to check the route documents that status — the guarantee the type
 * system provides for a guard attached directly to `guards`, but cannot for
 * one arriving through a security scheme, where the context type is erased.
 *
 * A `WeakMap` keyed on the guard keeps the function itself an ordinary,
 * property-free closure.
 */
const denialStatuses = new WeakMap<object, number>()

/**
 * The status a guard denies with, when it is known — i.e. when the guard came
 * from {@link requireContext}. `undefined` for a hand-written guard, whose
 * denial can vary per request and so cannot be checked up front.
 */
export const denialStatusOf = (guard: object): number | undefined => denialStatuses.get(guard)
