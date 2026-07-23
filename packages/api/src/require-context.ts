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
 * // Roles, scopes, feature flags — same shape, a different predicate.
 * export const requireAdmin = requireContext(
 *   (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.user.role === 'admin',
 *   { status: 403, body: { error: 'forbidden' } },
 * )
 * ```
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
  allow: (context: ContextGuardInput<Context>) => boolean | Promise<boolean>,
  denied: Denied,
): ((context: ContextGuardInput<Context>) => Denied | undefined | Promise<Denied | undefined>) => {
  return (context) => {
    const verdict = allow(context)
    // A plain boolean stays fully synchronous — no promise is allocated on the
    // common in-process check (a session already on the context).
    if (typeof verdict === 'boolean') return verdict ? undefined : denied
    return verdict.then((ok) => (ok ? undefined : denied))
  }
}
