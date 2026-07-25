import type {
  AnyRouteContract,
  ContextGuardInput,
  ErasedRequestContext,
  RouteReplyValue,
  SecurityRequirements,
} from './types'

/**
 * The OpenAPI extension key under which a Security Scheme Object carries its
 * runtime guard. `x-*` is the spec's extension namespace, and the value is a
 * function — so `JSON.stringify` drops it and it never reaches the wire
 * document (the OpenAPI generator strips it from the in-memory document too).
 * Exported so call sites can write `[securityGuard]: requireSession` instead of
 * a bare string, though the literal `'x-guard'` works just as well.
 */
export const securityGuard = 'x-guard'

/**
 * The erased guard shape a scheme guard is stored as — the same element type
 * {@link AnyRouteContract.guards} holds. A guard authored over
 * {@link ContextGuardInput} (what {@link requireContext} produces) is assignable
 * to this, which is why one `requireSession` attaches to every route regardless
 * of its schemas.
 */
type ErasedGuard = (
  context: ErasedRequestContext,
) => RouteReplyValue | Response | undefined | Promise<RouteReplyValue | Response | undefined>

/**
 * A reusable guard attached to a security scheme via {@link securityGuard}. It
 * sees the widened {@link ContextGuardInput} — the request slots are `unknown`,
 * the app `context` stays typed — and returns a reply to **deny** or
 * `undefined` to **pass**, exactly like any route guard. Build one with
 * {@link requireContext}, or write it inline.
 */
export type SecurityGuard<Context = unknown> = (
  context: ContextGuardInput<Context>,
) => RouteReplyValue | Response | undefined | Promise<RouteReplyValue | Response | undefined>

/**
 * A named OpenAPI Security Scheme Object that additionally carries the guard
 * {@link secureRoutes} enforces it with. Everything but {@link securityGuard} is
 * passed through to `components.securitySchemes` verbatim (any scheme OpenAPI
 * 3.1 supports); the guard itself is stripped from the document.
 *
 * The guard slot is typed over `never` context so a guard authored for any app
 * context — a `requireContext<AppContext>` guard, whose context type is already
 * pinned where it was written — drops in without re-annotation, the same way
 * {@link AnyRouteContract} accepts any concrete route guard.
 */
export type SecurityScheme = Readonly<Record<string, unknown>> & {
  readonly 'x-guard'?: SecurityGuard<never>
}

/**
 * Options for {@link secureRoutes}: the guarded scheme definitions and the
 * document-level default security requirement.
 */
export type SecureRoutesOptions = {
  /**
   * Named Security Scheme Objects, each optionally carrying a {@link securityGuard}
   * guard. Pass this same object to `createApi`/`compileToModule` as
   * `securitySchemes` so the document and the enforcement share one declaration.
   */
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>
  /**
   * The document-level default security requirement, applied to every route
   * that does not declare its own `security`. This is what turns the API
   * deny-by-default: set `[{ bearerAuth: [] }]` and every route needs a session
   * unless it opts out with `security: []`.
   */
  readonly security?: SecurityRequirements
}

/**
 * Resolves each route's OpenAPI `security` requirement into the guards that
 * enforce it, and prepends them to the route's own `guards`. This is the
 * deny-by-default counterpart to the per-route `guards` field: rather than
 * opting each protected route in, you declare a document-level `security`
 * default (with `x-guard` on the schemes) and opt the **public** routes out
 * with `security: []` — the OpenAPI default/override model, made to enforce.
 *
 * Resolution mirrors OpenAPI's semantics exactly:
 *
 * - A route's effective requirement is its own `security` when set, otherwise
 *   the document default. `security: []` (an explicit empty array) is the
 *   public opt-out — the route keeps only the guards it declared.
 * - Within one requirement object, every scheme's guard must pass (an AND):
 *   they attach as individual guards and run in order, first denial winning.
 * - Multiple requirement objects OR together: the request is allowed as soon
 *   as any one of them passes all its schemes. That combinator becomes a
 *   single composite guard.
 *
 * A scheme named by an effective requirement that is not defined — or is
 * defined without an `x-guard` — is a startup error, naming the route and
 * scheme. That is the fail-closed guarantee: you cannot document a route as
 * requiring auth and have it silently serve unprotected. Mark it public with
 * `security: []` if that is what you meant.
 *
 * The result is a plain array of route contracts with the guards merged onto
 * `guards`, so both engines honor them with no further wiring: `createApi`
 * runs them per request, and `compileToModule` threads the same live
 * `contract.guards` through its emitted guard loop.
 *
 * @example
 * ```typescript
 * const securitySchemes = {
 *   bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireSession },
 *   adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
 * } as const
 * const security = [{ bearerAuth: [] }] // default for every route
 *
 * export const routes = secureRoutes([getProfile, getAdminPanel, health], {
 *   securitySchemes,
 *   security,
 * })
 * // getAdminPanel overrides with `security: [{ adminAuth: [] }]`;
 * // health opts out with `security: []`.
 *
 * // createApi({ routes, securitySchemes, security }) — one declaration, doc + runtime.
 * ```
 */
export const secureRoutes = (routes: readonly AnyRouteContract[], options: SecureRoutesOptions): AnyRouteContract[] => {
  const documentSecurity = options.security
  const schemes = options.securitySchemes
  return routes.map((route) => {
    const effective = route.security ?? documentSecurity
    // No effective requirement, or an explicit public opt-out (`security: []`):
    // the route keeps exactly the guards it declared, untouched.
    if (effective === undefined || effective.length === 0) return route
    const guards = resolveGuards(effective, schemes, route)
    if (guards.length === 0) return route
    // Security guards are the coarse gate — they run before the route's own
    // fine-grained guards.
    return { ...route, guards: [...guards, ...(route.guards ?? [])] }
  })
}

/**
 * The guards enforcing one route's effective security requirement. A single
 * requirement is a pure AND, so its schemes' guards attach individually (the
 * guard chain already runs them in order, first denial winning) and the common
 * single-scheme case stays a lone, allocation-free guard. Several requirements
 * OR together and collapse to one composite guard.
 */
const resolveGuards = (
  effective: SecurityRequirements,
  schemes: Readonly<Record<string, SecurityScheme>>,
  route: AnyRouteContract,
): ErasedGuard[] => {
  if (effective.length === 1) {
    return Object.keys(effective[0] as Record<string, readonly string[]>).map((name) => guardFor(name, schemes, route))
  }
  return [orGuard(effective, schemes, route)]
}

/**
 * Looks up the guard a scheme name resolves to, throwing the fail-closed
 * startup error when the scheme is undefined or carries no guard.
 */
const guardFor = (
  name: string,
  schemes: Readonly<Record<string, SecurityScheme>>,
  route: AnyRouteContract,
): ErasedGuard => {
  const where = route.method.toUpperCase() + ' ' + route.path
  const scheme = schemes[name]
  if (scheme === undefined) {
    throw new Error(
      `secureRoutes: ${where} requires security scheme '${name}', which is not defined in securitySchemes.`,
    )
  }
  const guard = scheme[securityGuard]
  if (typeof guard !== 'function') {
    throw new Error(
      `secureRoutes: security scheme '${name}' (required by ${where}) has no '${securityGuard}' guard. ` +
        `Add one, or mark the operation public with \`security: []\`.`,
    )
  }
  return guard as ErasedGuard
}

/**
 * The OR combinator for a route whose `security` lists several requirement
 * objects: run each alternative's guards (an AND, first denial winning), and
 * allow the request the moment any alternative passes. When every alternative
 * denies, the last denial is what the client sees.
 */
const orGuard = (
  effective: SecurityRequirements,
  schemes: Readonly<Record<string, SecurityScheme>>,
  route: AnyRouteContract,
): ErasedGuard => {
  const alternatives = effective.map((requirement) =>
    Object.keys(requirement).map((name) => guardFor(name, schemes, route)),
  )
  return async (context) => {
    let denial: RouteReplyValue | Response | undefined
    for (const guards of alternatives) {
      let denied: RouteReplyValue | Response | undefined
      for (const guard of guards) {
        denied = await guard(context)
        if (denied !== undefined) break
      }
      // An alternative whose every scheme passed satisfies the request.
      if (denied === undefined) return undefined
      denial = denied
    }
    return denial
  }
}
