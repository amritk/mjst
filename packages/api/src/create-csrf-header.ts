/**
 * Options for {@link createCsrfHeader}. Defaults mirror {@link createCsrf} so
 * the client and server halves of the double-submit pair line up with no
 * configuration.
 */
export type CsrfHeaderOptions = {
  /** Cookie the server seeds the token in. Defaults to `csrf_token`. */
  readonly cookieName?: string
  /** Header the token is echoed in. Defaults to `x-csrf-token`. */
  readonly headerName?: string
  /**
   * Source of the cookie string. Defaults to `document.cookie` in the browser
   * and `''` elsewhere (so importing this in a non-DOM bundle never throws).
   * Injectable for tests.
   */
  readonly cookies?: () => string
}

/** Reads one cookie's value from a `document.cookie`-style string. */
const readCookie = (cookieString: string, name: string): string | undefined => {
  for (const pair of cookieString.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * The client half of double-submit CSRF: a `headers` provider for
 * `createClient` that reads the non-`HttpOnly` `csrf_token` cookie and echoes
 * it in the `x-csrf-token` header, which is exactly what {@link createCsrf} on
 * the server compares the cookie against. Without it, every unsafe-method call
 * a CSRF-protected server sees is rejected `403`.
 *
 * The header is sent on every request, not just writes — harmless, since the
 * server only checks it on unsafe methods, and it keeps this a plain header
 * provider with no per-call method logic. Returns an empty object when no
 * cookie is present yet (e.g. before the first response seeds one), so calls
 * are never blocked client-side.
 *
 * @example
 * ```typescript
 * const client = createClient(contracts, 'https://api.example.com', {
 *   fetchOptions: { credentials: 'include' },
 *   headers: createCsrfHeader(),
 * })
 * ```
 */
export const createCsrfHeader = (options?: CsrfHeaderOptions): (() => Readonly<Record<string, string>>) => {
  const cookieName = options?.cookieName ?? 'csrf_token'
  const headerName = options?.headerName ?? 'x-csrf-token'
  // Reached through globalThis so this typechecks without the DOM lib and never
  // throws when imported into a non-browser (worker/Node) bundle.
  const cookies = options?.cookies ?? (() => (globalThis as { document?: { cookie?: string } }).document?.cookie ?? '')

  return () => {
    const token = readCookie(cookies(), cookieName)
    return token === undefined ? {} : { [headerName]: token }
  }
}
