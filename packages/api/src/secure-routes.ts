import { denialStatusOf } from './require-context'
import type {
  AnyRouteContract,
  ContextGuardInput,
  ErasedGuard,
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
 * A reusable guard attached to a security scheme via {@link securityGuard}. It
 * sees the widened {@link ContextGuardInput} — the request slots are `unknown`,
 * the app `context` stays typed — and returns a reply to **deny** or
 * `undefined` to **pass**, exactly like any route guard. Build one with
 * {@link requireContext}, or write it inline.
 *
 * The second argument is the **scopes** the requirement asked for: the values
 * of the requirement object, so `security: [{ bearerAuth: ['billing:read'] }]`
 * calls the `bearerAuth` guard with `['billing:read']`. One scheme's guard
 * therefore enforces every scope combination the document advertises, instead
 * of the document promising a restriction the runtime does not apply. Guards
 * that do not take the parameter simply ignore it.
 */
export type SecurityGuard<Context = unknown> = (
  context: ContextGuardInput<Context>,
  scopes: readonly string[],
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
  /**
   * Allow an **empty requirement object** (`{}`) inside a `security` list.
   * OpenAPI reads `[{ bearerAuth: [] }, {}]` as "auth is optional", so a stray
   * `{}` silently makes a route public — including a document-level `[{}]`,
   * which would open the whole API. Because that is indistinguishable from a
   * typo, it is a startup error unless you set this, and `security: []` stays
   * the ordinary way to mark one route public.
   *
   * @default false
   */
  readonly allowOptionalSecurity?: boolean
  /**
   * Skip the check that every guard's denial status is declared in the route's
   * `responses`. The check restores what type erasure takes away: a
   * `requireContext` guard denying with 401 attached directly to `guards` is a
   * compile error when the route does not document 401, but a guard arriving
   * through a scheme cannot be. Leaving it on keeps the document honest and
   * stops `validateResponses` from turning a denial into a 500.
   *
   * @default false
   */
  readonly allowUndeclaredDenials?: boolean
}

/**
 * Routes that have been through {@link secureRoutes}. Membership — not the
 * presence of guards — is what {@link assertRoutesSecured} checks, because a
 * route can legitimately come out with no guards (`security: []`, or an
 * allowed `{}`), and those cases must stay distinguishable from a route whose
 * requirement was never resolved at all.
 *
 * The value is the document-level default that was in effect, so the engines can
 * also catch the subtler drift of resolving against one default and documenting
 * another.
 *
 * A `WeakMap` rather than a marker property: it adds nothing to the contract's
 * shape, so nothing leaks into the OpenAPI document, the contract hash, or a
 * structured clone.
 */
const securedRoutes = new WeakMap<AnyRouteContract, SecurityRequirements | undefined>()

/**
 * Resolves each route's OpenAPI `security` requirement into the guards that
 * enforce it, and attaches them as the route's `securityGuards`. This is the
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
 * - A requirement's **scopes** reach the scheme's guard as its second argument,
 *   so `[{ oauth2: ['admin'] }]` and `[{ oauth2: [] }]` enforce differently.
 *
 * Three things are startup errors, all of them fail-closed:
 *
 * 1. A scheme named by an effective requirement that is not defined, or is
 *    defined without an `x-guard` — you cannot document a route as requiring
 *    auth and have it silently serve unprotected.
 * 2. An empty requirement object (`{}`), which OpenAPI reads as "auth
 *    optional"; see {@link SecureRoutesOptions.allowOptionalSecurity}.
 * 3. A guard whose denial status the route's `responses` does not declare; see
 *    {@link SecureRoutesOptions.allowUndeclaredDenials}.
 *
 * Mark an operation public with `security: []` if that is what you meant.
 *
 * Unlike the route's own `guards`, the resolved security guards run **before**
 * slot validation, body parsing and `refine` — an unauthenticated caller never
 * reaches the body parser, the schema error detail, or app code. They see the
 * app `context` and the raw `request`; the validated slots are `undefined`.
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
  return routes.map((route) => {
    const effective = route.security ?? documentSecurity
    // No effective requirement, or an explicit public opt-out (`security: []`):
    // the route keeps exactly the guards it declared, untouched.
    if (effective === undefined || effective.length === 0) {
      securedRoutes.set(route, documentSecurity)
      return route
    }
    const guards = resolveGuards(effective, options, route)
    if (guards.length === 0) {
      securedRoutes.set(route, documentSecurity)
      return route
    }
    const secured = { ...route, securityGuards: guards }
    securedRoutes.set(secured, documentSecurity)
    return secured
  })
}

/**
 * Throws when a route's effective security requirement was never resolved into
 * guards — i.e. `secureRoutes` was not called on it. Without this, declaring
 * `security` on `createApi` publishes a document asserting every operation
 * needs auth while the routes serve anonymously, which is precisely the
 * silently-open endpoint `secureRoutes` exists to prevent.
 *
 * Called by both engines at startup. Routes with no effective requirement, or
 * with the `security: []` opt-out, pass regardless.
 */
export const assertRoutesSecured = (
  routes: readonly AnyRouteContract[],
  documentSecurity: SecurityRequirements | undefined,
  caller: string,
): void => {
  for (const route of routes) {
    const effective = route.security ?? documentSecurity
    if (effective === undefined || effective.length === 0) continue
    if (!securedRoutes.has(route)) {
      const source = route.security !== undefined ? 'its own `security`' : 'the document-level `security` default'
      throw new Error(
        `${caller}: ${where(route)} is documented as requiring authentication by ${source}, but its ` +
          'requirement was never resolved into guards, so it would serve unauthenticated requests. ' +
          'Pass the routes through `secureRoutes(routes, { securitySchemes, security })` before ' +
          `${caller}, or mark the operation public with \`security: []\`.`,
      )
    }
    // The route was secured, but possibly against a different default than the
    // one being documented — which puts the document and the runtime back out
    // of step for exactly the routes that rely on the default.
    if (route.security !== undefined) continue
    const resolvedAgainst = securedRoutes.get(route)
    if (sameRequirements(resolvedAgainst, documentSecurity)) continue
    throw new Error(
      `${caller}: ${where(route)} relies on the document-level \`security\` default, but \`secureRoutes\` ` +
        `resolved it against ${JSON.stringify(resolvedAgainst) ?? 'no default'} while ${caller} documents ` +
        `${JSON.stringify(documentSecurity)}. Pass the same \`security\` to both.`,
    )
  }
}

/**
 * Requirement lists are plain JSON data, so comparing their serialization is
 * both exact and cheap enough for a startup check.
 */
const sameRequirements = (a: SecurityRequirements | undefined, b: SecurityRequirements | undefined): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * The guards enforcing one route's effective security requirement. A single
 * requirement is a pure AND, so its schemes' guards attach individually — the
 * pipeline's guard loop already runs them in order, first denial winning, so
 * the common single-scheme case stays one guard deep. Several requirements OR
 * together and collapse to one composite guard.
 */
const resolveGuards = (
  effective: SecurityRequirements,
  options: SecureRoutesOptions,
  route: AnyRouteContract,
): ErasedGuard[] => {
  // An empty requirement object anywhere in the list means "auth optional",
  // which makes every sibling alternative moot — reject it, or honour it by
  // leaving the route public, but never treat it as enforcement.
  for (const requirement of effective) {
    if (Object.keys(requirement).length > 0) continue
    if (options.allowOptionalSecurity === true) return []
    throw new Error(
      `secureRoutes: ${where(route)} lists an empty security requirement object (\`{}\`), which OpenAPI ` +
        'reads as "authentication optional" — it would leave the operation public and make every other ' +
        'alternative in the list moot. Mark the operation public with `security: []`, or set ' +
        '`allowOptionalSecurity: true` if optional authentication is genuinely what you want.',
    )
  }
  // Resolution is memoized per (scheme, scopes) so two alternatives naming the
  // same scheme share one guard — which is what lets the OR combinator skip a
  // guard it has already run for this request.
  const resolved = new Map<string, ErasedGuard>()
  const forRequirement = (requirement: Readonly<Record<string, readonly string[]>>): ErasedGuard[] =>
    Object.entries(requirement).map(([name, scopes]) => {
      const key = name + '\u0000' + scopes.join(' ')
      const cached = resolved.get(key)
      if (cached !== undefined) return cached
      const guard = guardFor(name, scopes, options, route)
      resolved.set(key, guard)
      return guard
    })

  if (effective.length === 1) return forRequirement(effective[0] as Readonly<Record<string, readonly string[]>>)
  return [orGuard(effective.map(forRequirement))]
}

/** `METHOD /path`, for the startup errors. */
const where = (route: AnyRouteContract): string => route.method.toUpperCase() + ' ' + route.path

/**
 * Looks up the guard a scheme name resolves to, throwing the fail-closed
 * startup error when the scheme is undefined or carries no guard, and binding
 * the requirement's scopes into it so the guard can enforce them.
 */
const guardFor = (
  name: string,
  scopes: readonly string[],
  options: SecureRoutesOptions,
  route: AnyRouteContract,
): ErasedGuard => {
  const scheme = options.securitySchemes[name]
  if (scheme === undefined) {
    throw new Error(
      `secureRoutes: ${where(route)} requires security scheme '${name}', which is not defined in securitySchemes.`,
    )
  }
  const guard = scheme[securityGuard]
  if (typeof guard !== 'function') {
    throw new Error(
      `secureRoutes: security scheme '${name}' (required by ${where(route)}) has no '${securityGuard}' guard. ` +
        `Add one, or mark the operation public with \`security: []\`.`,
    )
  }
  assertDenialDeclared(guard, name, options, route)
  const typed = guard as unknown as (
    context: ErasedRequestContext,
    scopes: readonly string[],
  ) => RouteReplyValue | Response | undefined | Promise<RouteReplyValue | Response | undefined>
  // The scopes are bound here, once at startup, rather than threaded through
  // the per-request guard signature — that keeps `securityGuards` the same
  // one-argument shape the pipeline's guard loops already run, and means a
  // guard is never called without the scopes it may be reading.
  return (context) => typed(context, scopes)
}

/**
 * Restores the guarantee type erasure removes: a guard built by
 * `requireContext` knows the status it denies with, so a route that never
 * declared that status can be caught here rather than turning into an
 * `invalid_response` 500 under `validateResponses`.
 */
const assertDenialDeclared = (
  guard: object,
  name: string,
  options: SecureRoutesOptions,
  route: AnyRouteContract,
): void => {
  if (options.allowUndeclaredDenials === true) return
  const status = denialStatusOf(guard)
  if (status === undefined) return
  if (route.responses[status] !== undefined) return
  throw new Error(
    `secureRoutes: security scheme '${name}' (required by ${where(route)}) denies with ${status}, but the ` +
      `route's \`responses\` does not declare ${status}. Add it so the document stays honest and the denial ` +
      'is not rejected as an invalid response, or set `allowUndeclaredDenials: true`.',
  )
}

/**
 * The OR combinator for a route whose `security` lists several requirement
 * objects: run each alternative's guards (an AND, first denial winning), and
 * allow the request the moment any alternative passes.
 *
 * The client sees the **first** alternative's denial, which is the one the
 * document lists first and so the primary way in — reporting the last one
 * instead makes the status depend on array order in the least useful
 * direction (a trailing admin alternative turning an anonymous 401 into 403).
 *
 * A guard shared by two alternatives runs once per request: `resolveGuards`
 * hands identical schemes the same function, and the results are memoized
 * below. The whole combinator stays synchronous until a guard actually returns
 * a promise, matching the guard loops in both engines.
 */
const orGuard = (alternatives: readonly ErasedGuard[][]): ErasedGuard => {
  return (context) => {
    // Per request, so a scheme required by several alternatives is not
    // re-checked (and any I/O it does is not repeated).
    const seen = new Map<ErasedGuard, RouteReplyValue | Response | undefined>()

    const runAlternative = (
      guards: readonly ErasedGuard[],
      index: number,
    ): RouteReplyValue | Response | undefined | Promise<RouteReplyValue | Response | undefined> => {
      let i = index
      while (i < guards.length) {
        const guard = guards[i++] as ErasedGuard
        if (seen.has(guard)) {
          const cached = seen.get(guard)
          if (cached !== undefined) return cached
          continue
        }
        const result = guard(context)
        if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
          const next = i
          return (result as Promise<RouteReplyValue | Response | undefined>).then((value) => {
            seen.set(guard, value)
            return value !== undefined ? value : runAlternative(guards, next)
          })
        }
        const value = result as RouteReplyValue | Response | undefined
        seen.set(guard, value)
        if (value !== undefined) return value
      }
      return undefined
    }

    const runFrom = (
      index: number,
      firstDenial: RouteReplyValue | Response | undefined,
    ): RouteReplyValue | Response | undefined | Promise<RouteReplyValue | Response | undefined> => {
      let denial = firstDenial
      for (let i = index; i < alternatives.length; i++) {
        const outcome = runAlternative(alternatives[i] as ErasedGuard[], 0)
        if (typeof (outcome as PromiseLike<unknown>)?.then === 'function') {
          const next = i + 1
          const carried = denial
          return (outcome as Promise<RouteReplyValue | Response | undefined>).then((value) =>
            // An alternative whose every scheme passed satisfies the request.
            value === undefined ? undefined : runFrom(next, carried ?? value),
          )
        }
        const value = outcome as RouteReplyValue | Response | undefined
        if (value === undefined) return undefined
        denial ??= value
      }
      return denial
    }

    return runFrom(0, undefined)
  }
}
