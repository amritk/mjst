/**
 * Options for {@link createDocs}.
 */
export type DocsOptions = {
  /**
   * URL the rendered page fetches the OpenAPI document from. Defaults to
   * `/openapi.json` — the {@link import('./types').ApiOptions.openApiPath}
   * default. Point it elsewhere if you moved or proxied the document.
   */
  readonly specUrl?: string
  /** Page `<title>`. Defaults to `'API Reference'`. */
  readonly title?: string
  /**
   * Base the Scalar bundle loads from, composed with {@link DocsOptions.version}
   * into `<cdn>/@scalar/api-reference@<version>`. Defaults to the jsDelivr CDN.
   * Point it at your own origin when a strict CSP forbids third-party scripts.
   */
  readonly cdn?: string
  /**
   * `@scalar/api-reference` version to load. Defaults to {@link SCALAR_VERSION}
   * — a pin, because the previous floating `@scalar/api-reference` specifier
   * meant every page load ran whatever the CDN published most recently, so a
   * bad release (or a compromised one) reached users with no change on your
   * side. Pass an empty string to drop the version segment entirely, for a
   * self-hosted bundle served at a fixed path.
   */
  readonly version?: string
  /**
   * Subresource-integrity hash for the bundle (`sha384-…`), set as the
   * script's `integrity` attribute so the browser refuses a script whose bytes
   * do not match. Strongly recommended alongside a version pin: the pin says
   * *which* release, the hash says *these exact bytes*.
   *
   * There is deliberately no default. The correct hash depends on the exact
   * URL — change `cdn` or `version` and a baked-in hash silently blocks the
   * script instead of loading it — so it has to come from wherever you
   * actually serve the bundle:
   *
   * ```sh
   * curl -sL https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.64.0 |
   *   openssl dgst -sha384 -binary | openssl base64 -A
   * ```
   */
  readonly integrity?: string
}

/**
 * The pinned `@scalar/api-reference` release. Bump it deliberately (and
 * recompute any `integrity` hash alongside it) rather than letting the CDN
 * decide per page load.
 */
export const SCALAR_VERSION = '1.64.0'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  )

/**
 * Builds the self-contained HTML for a Scalar API reference page. Exported so
 * an app that serves its own routes (a Next.js page, a custom mount) can render
 * the same markup without going through {@link createDocs}.
 *
 * Every interpolated option is HTML-escaped. `cdn` used not to be, which let a
 * value like `x" onload="…` close the `src` attribute and add an event handler
 * — and these options routinely come from config rather than from a literal in
 * the source file.
 */
export const docsHtml = (options?: DocsOptions): string => {
  const specUrl = escapeHtml(options?.specUrl ?? '/openapi.json')
  const title = escapeHtml(options?.title ?? 'API Reference')
  const cdn = escapeHtml(options?.cdn ?? 'https://cdn.jsdelivr.net/npm')
  const version = escapeHtml(options?.version ?? SCALAR_VERSION)
  const integrity = options?.integrity === undefined ? '' : ` integrity="${escapeHtml(options.integrity)}"`
  // An SRI-checked script must be fetched CORS-wise, or the browser cannot see
  // the bytes it is meant to hash and blocks it outright.
  const crossOrigin = options?.integrity === undefined ? '' : ' crossorigin="anonymous"'
  const src = `${cdn}/@scalar/api-reference${version === '' ? '' : `@${version}`}`

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><script id="api-reference" data-url="${specUrl}"></script><script src="${src}"${integrity}${crossOrigin}></script></body></html>`
}

/**
 * Serves an interactive Scalar API reference page — the Swagger UI / ReDoc
 * surface FastAPI and NestJS give you out of the box, which this framework left
 * implicit behind the raw `openapi.json`. Returns a `(Request) => Response`
 * shaped for the `mounts` option, so a single line puts human-readable docs
 * next to the machine-readable document. Scalar's bundle loads from a CDN at
 * view time (no server dependency added) at a pinned version; self-host it via
 * `cdn` under a strict CSP, and set `integrity` to have the browser verify the
 * bytes.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, {
 *   mounts: { '/docs': createDocs() }, // GET /docs → interactive reference
 * })
 * ```
 */
export const createDocs = (options?: DocsOptions): ((request: Request) => Response) => {
  const html = docsHtml(options)
  const body = new TextEncoder().encode(html)
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}
