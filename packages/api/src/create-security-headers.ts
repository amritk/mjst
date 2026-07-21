import type { FetchOnResponse } from './to-fetch-handler'

/**
 * Options for {@link createSecurityHeaders}. Every field is opt-out: the
 * defaults are the conservative set hono/secure-headers and helmet apply, so
 * `createSecurityHeaders()` with no arguments is a sensible baseline. Set a
 * field to `false` to omit that header, or to a string to override its value.
 */
export type SecurityHeadersOptions = {
  /**
   * `strict-transport-security`. Defaults to **off** — HSTS on a bare IP or a
   * plain-HTTP dev origin locks browsers out, so opt in explicitly for
   * production HTTPS. `true` uses `max-age=15552000; includeSubDomains`.
   */
  readonly strictTransportSecurity?: boolean | string
  /** `x-content-type-options`. Defaults to `nosniff`. */
  readonly contentTypeOptions?: boolean | string
  /** `x-frame-options`. Defaults to `SAMEORIGIN`. */
  readonly frameOptions?: boolean | string
  /** `referrer-policy`. Defaults to `no-referrer`. */
  readonly referrerPolicy?: boolean | string
  /** `cross-origin-opener-policy`. Defaults to `same-origin`. */
  readonly crossOriginOpenerPolicy?: boolean | string
  /** `cross-origin-resource-policy`. Defaults to `same-origin`. */
  readonly crossOriginResourcePolicy?: boolean | string
  /** `origin-agent-cluster`. Defaults to `?1`. */
  readonly originAgentCluster?: boolean | string
  /** `x-dns-prefetch-control`. Defaults to `off`. */
  readonly dnsPrefetchControl?: boolean | string
  /**
   * `content-security-policy`. Defaults to **off** — a CSP that fits one app
   * breaks another, so there is no safe default. Pass the policy string to
   * apply it.
   */
  readonly contentSecurityPolicy?: string
}

/** Resolves a `boolean | string` field to the header value, or `undefined` to omit it. */
const pick = (value: boolean | string | undefined, fallback: string): string | undefined => {
  if (value === false) return undefined
  if (value === undefined || value === true) return fallback
  return value
}

/**
 * A response decorator that stamps the standard browser-hardening headers on
 * every reply — the `helmet`/`secure-headers` middleware every framework in
 * the ecosystem ships, expressed as one `onResponse` hook. Header names are
 * only set when absent so a handler that deliberately set its own (a permissive
 * `x-frame-options` on an embeddable widget route) wins.
 *
 * HSTS and CSP default off because both have failure modes that a blanket
 * default would inflict on the wrong deployment; everything else is the
 * conservative baseline.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, {
 *   onResponse: [createSecurityHeaders({ strictTransportSecurity: true })],
 * })
 * ```
 */
export const createSecurityHeaders = (options?: SecurityHeadersOptions): FetchOnResponse => {
  const entries: Array<readonly [string, string]> = []
  const add = (name: string, value: string | undefined): void => {
    if (value !== undefined) entries.push([name, value])
  }
  add(
    'strict-transport-security',
    pick(options?.strictTransportSecurity ?? false, 'max-age=15552000; includeSubDomains'),
  )
  add('x-content-type-options', pick(options?.contentTypeOptions, 'nosniff'))
  add('x-frame-options', pick(options?.frameOptions, 'SAMEORIGIN'))
  add('referrer-policy', pick(options?.referrerPolicy, 'no-referrer'))
  add('cross-origin-opener-policy', pick(options?.crossOriginOpenerPolicy, 'same-origin'))
  add('cross-origin-resource-policy', pick(options?.crossOriginResourcePolicy, 'same-origin'))
  add('origin-agent-cluster', pick(options?.originAgentCluster, '?1'))
  add('x-dns-prefetch-control', pick(options?.dnsPrefetchControl, 'off'))
  if (options?.contentSecurityPolicy !== undefined)
    entries.push(['content-security-policy', options.contentSecurityPolicy])

  return (response) => {
    for (const [name, value] of entries) {
      if (!response.headers.has(name)) response.headers.set(name, value)
    }
    return undefined
  }
}
