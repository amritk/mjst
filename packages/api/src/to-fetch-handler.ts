import type { Api } from './types'

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
export const toFetchHandler = (api: Api): ((request: Request) => Promise<Response>) => {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const response = await api.handle({
      method: request.method,
      path: url.pathname,
      searchParams: () => url.searchParams,
      header: (name) => request.headers.get(name) ?? undefined,
      readBody: () => request.json(),
    })
    const init: ResponseInit =
      response.headers === undefined
        ? { status: response.status }
        : { status: response.status, headers: { ...response.headers } }
    if (response.body === undefined) {
      return new Response(null, init)
    }
    // Response.json sets content-type: application/json unless the init
    // headers already carry one, so custom headers win.
    return Response.json(response.body, init)
  }
}
