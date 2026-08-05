/**
 * A ready-made `exempt` predicate for {@link createCsrf}: it skips the
 * double-submit check for requests that authenticate with a bearer token.
 *
 * Native apps (and any other non-browser client) have no cookie jar and no page
 * script, so they can neither receive the seeded `csrf_token` cookie nor echo it
 * back — every unsafe-method call from one would take a `403` without an
 * exemption. This is the safe way to write that exemption.
 *
 * What makes it safe is the **absence of cookies**, not the presence of the
 * bearer header. The double-submit cookie exists to stop a browser being driven
 * cross-site into spending its ambient cookies; a client with no cookie jar has
 * no ambient credential to spend, so there is nothing to forge. A bearer token
 * is the opposite of ambient — it only rides a request because code put it
 * there, and an attacker who knows it does not need a victim's browser at all.
 *
 * Hence both conditions. Keying on the header alone would be a bypass: a
 * cross-site page can bolt `Authorization: Bearer anything` onto a credentialed
 * request, and the header does not have to be valid to switch the check off
 * while the victim's cookie still authenticates the call. That needs permissive
 * credentialed CORS to reach the server, but the CSRF check is the layer meant
 * to survive exactly that misconfiguration.
 *
 * The other tempting shortcut — exempting requests with no `Origin` header —
 * fails the same way from the other side: plenty of same-site form posts arrive
 * without one, so it hands the bypass to the browser traffic the check protects.
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
  // A request carrying cookies is a browser, whatever else it also carries, and
  // a browser is the only thing CSRF can happen to. Exempting on the bearer
  // header alone would let a cross-site page bolt `Authorization: Bearer
  // anything` onto a credentialed request and switch the check off while the
  // victim's cookie still authenticates it — the attacker never needs the
  // header to be *valid*, only present. A genuine bearer client has no cookie
  // jar, which is the whole premise here, so this costs it nothing.
  if (request.headers.get('cookie') !== null) return false
  const authorization = request.headers.get('authorization')
  if (authorization === null) return false
  return /^bearer[ \t]+\S/i.test(authorization)
}
