/**
 * Which documentation renderer to serve. All three read the same OpenAPI
 * document the API already serves at `openApiPath`; they differ only in look.
 */
export type DocsUi = 'scalar' | 'swagger' | 'redoc'

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
  /** Renderer. Defaults to `'scalar'`. */
  readonly ui?: DocsUi
  /** Page `<title>`. Defaults to `'API Reference'`. */
  readonly title?: string
  /**
   * Origin the renderer's script/styles load from. Defaults to the jsDelivr
   * CDN. Override to pin a version or to serve assets from your own origin
   * when a strict CSP forbids third-party scripts.
   */
  readonly cdn?: string
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  )

/**
 * Builds the self-contained HTML for a docs page. Exported so an app that
 * serves its own routes (a Next.js page, a custom mount) can render the same
 * markup without going through {@link createDocs}.
 */
export const docsHtml = (options?: DocsOptions): string => {
  const specUrl = escapeHtml(options?.specUrl ?? '/openapi.json')
  const title = escapeHtml(options?.title ?? 'API Reference')
  const cdn = options?.cdn ?? 'https://cdn.jsdelivr.net/npm'
  const ui = options?.ui ?? 'scalar'

  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`

  if (ui === 'swagger') {
    return `${head}<link rel="stylesheet" href="${cdn}/swagger-ui-dist/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="${cdn}/swagger-ui-dist/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:${JSON.stringify(specUrl)},dom_id:'#swagger-ui'})</script></body></html>`
  }
  if (ui === 'redoc') {
    return `${head}</head><body><redoc spec-url="${specUrl}"></redoc><script src="${cdn}/redoc/bundles/redoc.standalone.js"></script></body></html>`
  }
  // Scalar: the default. One data-url script plus the standalone bundle.
  return `${head}</head><body><script id="api-reference" data-url="${specUrl}"></script><script src="${cdn}/@scalar/api-reference"></script></body></html>`
}

/**
 * Serves an interactive API reference page — the Swagger UI / ReDoc surface
 * FastAPI and NestJS give you out of the box, which this framework left implicit
 * behind the raw `openapi.json`. Returns a `(Request) => Response` shaped for
 * the `mounts` option, so a single line puts human-readable docs next to the
 * machine-readable document. The renderer's assets load from a CDN at view
 * time (no server dependency added); pin or self-host them via `cdn` under a
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
