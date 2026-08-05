/**
 * A ready-made `exempt` predicate for {@link createCsrf}: it skips the
 * double-submit check for requests that authenticate with a bearer token.
 *
 * Native apps (and any other non-browser client) have no cookie jar and no page
 * script, so they can neither receive the seeded `csrf_token` cookie nor echo it
 * back — every unsafe-method call from one would take a `403` without an
 * exemption. This is the safe way to write that exemption.
 *
 * Keying on the `authorization` header is what makes it safe. The double-submit
 * cookie exists to stop a *browser* being driven cross-site into sending its
 * ambient cookies; a page on another origin cannot attach an `authorization`
 * header without a preflight this server never grants, so a request carrying one
 * is by construction not the attack the check defends against. The tempting
 * alternative — exempting requests with no `Origin` header — looks equivalent and
 * is not: plenty of same-site form posts arrive without one, so it hands the
 * bypass to exactly the browser traffic the check was protecting.
 *
 * The scheme match is case-insensitive per RFC 9110, and a bare `Bearer` with no
 * credential after it does not count as authenticated.
 *
 * @example
 * ```typescript
 * const csrf = createCsrf({ exempt: exemptBearer })
 * const handler = toFetchHandler(api, {
 *   onRequest: [csrf.onRequest],
 *   onResponse: [csrf.onResponse],
 * })
 * ```
 */
export const exemptBearer = (request: Request): boolean => {
  const authorization = request.headers.get('authorization')
  if (authorization === null) return false
  return /^bearer[ \t]+\S/i.test(authorization)
}
