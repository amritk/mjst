import type { Api } from './types'

/**
 * The handler shape every fetch runtime accepts. Cloudflare Workers invokes it
 * as `fetch(request, env, executionContext)`; Bun, Deno, Hono, and Next.js
 * pass only the request. The extra arguments flow through to the
 * `createApi({ context })` factory untouched.
 */
export type FetchHandler = (request: Request, env?: unknown, executionContext?: unknown) => Promise<Response>

/**
 * Options for {@link toFetchHandler}.
 */
export type FetchHandlerOptions = {
  /**
   * Sub-handlers that own everything under a path prefix, checked before
   * routing. The raw `Request` passes straight through and the mount's
   * `Response` comes straight back — no conversion, streaming intact — which
   * is exactly what self-contained routers like Better Auth's `auth.handler`
   * need:
   *
   * ```typescript
   * toFetchHandler(api, { mounts: { '/api/auth': (request) => auth.handler(request) } })
   * ```
   */
  readonly mounts?: Readonly<Record<string, (request: Request) => Response | Promise<Response>>>
}

/**
 * Wraps an API in a Web-standard `(Request) => Promise<Response>` handler —
 * the shape Hono mounts, Next.js route handlers export, and `Bun.serve`,
 * Cloudflare Workers, and Deno accept directly.
 *
 * @example
 * ```typescript
 * // Bun / Workers / Deno
 * const handler = toFetchHandler(api)
 * Bun.serve({ fetch: handler })
 *
 * // Hono
 * app.mount('/', handler)
 *
 * // Next.js app router (app/[...route]/route.ts)
 * export const GET = handler
 * export const POST = handler
 * ```
 */
export const toFetchHandler = (api: Api, options?: FetchHandlerOptions): FetchHandler => {
  const mounts = Object.entries(options?.mounts ?? {}).map(([prefix, mount]) => {
    if (!prefix.startsWith('/')) throw new Error(`Mount prefix must start with '/': '${prefix}'`)
    return [prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix, mount] as const
  })

  // One ResponseInit per status code, reused across requests — building JSON
  // responses via `new Response(string, cachedInit)` instead of
  // `Response.json` benchmarked ~40% faster through the whole pipeline
  // (Response.json constructs a Headers object per call). The map stays tiny:
  // it can only hold statuses the app's handlers actually return.
  const inits = new Map<number, ResponseInit>()
  const initFor = (status: number): ResponseInit => {
    let init = inits.get(status)
    if (init === undefined) {
      init = { status, headers: JSON_HEADERS }
      inits.set(status, init)
    }
    return init
  }

  return async (request: Request, env?: unknown, executionContext?: unknown): Promise<Response> => {
    // The pathname is sliced out by hand instead of via `new URL(...)`: a URL
    // object parses and normalizes the entire URL (origin, auth, escaping),
    // which benchmarked at roughly a fifth of this adapter's per-request cost.
    // `request.url` is always absolute in fetch handlers, keeps its percent-
    // encoding, and carries no fragment, so scanning for the first '/' after
    // the scheme and an optional '?' yields the same pathname a URL would.
    const url = request.url
    const schemeEnd = url.indexOf('://')
    const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)
    const queryIndex = pathStart === -1 ? -1 : url.indexOf('?', pathStart)
    const path = pathStart === -1 ? '/' : queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex)

    for (const [prefix, mount] of mounts) {
      if (path === prefix || path.startsWith(prefix + '/')) return mount(request)
    }

    const response = await api.handle(
      {
        method: request.method,
        path,
        searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),
        header: (name) => request.headers.get(name) ?? undefined,
        readBody: () => request.json(),
      },
      env,
      executionContext,
    )
    if (response.headers === undefined) {
      if (response.body === undefined) return new Response(null, { status: response.status })
      return new Response(JSON.stringify(response.body), initFor(response.status))
    }
    if (response.body === undefined) {
      return new Response(null, { status: response.status, headers: { ...response.headers } })
    }
    // Custom headers win over the default content-type, matching Response.json.
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { ...JSON_HEADERS, ...response.headers },
    })
  }
}

/** Shared across every response with a JSON body and no custom headers. */
const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'content-type': 'application/json' })
