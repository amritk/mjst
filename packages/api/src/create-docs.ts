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
   * Origin the Scalar bundle loads from. Defaults to the jsDelivr CDN.
   * Override to pin a version or to serve the script from your own origin
   * when a strict CSP forbids third-party scripts.
   */
  readonly cdn?: string
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  )

/**
 * Builds the self-contained HTML for a Scalar API reference page. Exported so
 * an app that serves its own routes (a Next.js page, a custom mount) can render
 * the same markup without going through {@link createDocs}.
 */
export const docsHtml = (options?: DocsOptions): string => {
  const specUrl = escapeHtml(options?.specUrl ?? '/openapi.json')
  const title = escapeHtml(options?.title ?? 'API Reference')
  const cdn = options?.cdn ?? 'https://cdn.jsdelivr.net/npm'

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><script id="api-reference" data-url="${specUrl}"></script><script src="${cdn}/@scalar/api-reference"></script></body></html>`
}

/**
 * Serves an interactive Scalar API reference page — the Swagger UI / ReDoc
 * surface FastAPI and NestJS give you out of the box, which this framework left
 * implicit behind the raw `openapi.json`. Returns a `(Request) => Response`
 * shaped for the `mounts` option, so a single line puts human-readable docs
 * next to the machine-readable document. Scalar's bundle loads from a CDN at
 * view time (no server dependency added); pin or self-host it via `cdn` under a
 * strict CSP.
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
