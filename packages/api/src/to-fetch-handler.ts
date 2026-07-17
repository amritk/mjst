import { readBytesCapped } from './read-bytes-capped'
import type { Api, ApiRequest, StreamingBody } from './types'

/**
 * The handler shape every fetch runtime accepts. Cloudflare Workers invokes it
 * as `fetch(request, env, executionContext)`; Bun, Deno, Hono, and Next.js
 * pass only the request. The extra arguments flow through to the
 * `createApi({ context })` factory untouched.
 */
export type FetchHandler = (request: Request, env?: unknown, executionContext?: unknown) => Promise<Response>

/**
 * A pre-routing gate. Returning a `Response` short-circuits the request —
 * remaining gates, mounts, and routing are skipped — but the response still
 * flows through every {@link FetchOnResponse} hook, so a rate-limited 429
 * gets the same security headers as everything else. Returning `undefined`
 * lets the request continue. This is where CORS preflight, origin checks,
 * rate limits, and feature-flag gates live.
 */
export type FetchOnRequest = (
  request: Request,
  env?: unknown,
  executionContext?: unknown,
) => Response | undefined | Promise<Response | undefined>

/**
 * A response decorator, run on every outgoing response — routed replies,
 * mount replies, 404s, and gate short-circuits alike. Mutate the response's
 * headers in place and return nothing, or return a replacement `Response`.
 * Runs in array order, so later hooks see earlier hooks' changes.
 */
export type FetchOnResponse = (
  response: Response,
  request: Request,
) => Response | undefined | Promise<Response | undefined>

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
   *
   * Mounts still sit inside the hook chains: gates run before them and
   * response decorators after, so a mounted router is not a hole in the
   * app's headers or rate limits. A gate that must not apply to a mount
   * (a CSRF check exempting the auth routes, say) checks the path itself.
   */
  readonly mounts?: Readonly<Record<string, (request: Request) => Response | Promise<Response>>>
  /** Gate(s) run before mounts and routing, in order. See {@link FetchOnRequest}. */
  readonly onRequest?: FetchOnRequest | ReadonlyArray<FetchOnRequest>
  /** Decorator(s) run on every outgoing response, in order. See {@link FetchOnResponse}. */
  readonly onResponse?: FetchOnResponse | ReadonlyArray<FetchOnResponse>
  /**
   * Rejects request bodies larger than this many bytes with a 413, checked
   * against the declared `content-length` up front and enforced while the
   * body streams in (so a lying or chunked client is still cut off). Applies
   * to the pipeline's own body parsing and to handler-initiated
   * `readText`/`readBytes` calls alike. Unset means no limit.
   */
  readonly maxBodyBytes?: number
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
  const onRequest = toArray(options?.onRequest)
  const onResponse = toArray(options?.onResponse)
  const maxBodyBytes = options?.maxBodyBytes

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

  const finish = async (response: Response, request: Request): Promise<Response> => {
    let current = response
    for (const hook of onResponse) {
      current = (await hook(current, request)) ?? current
    }
    return current
  }

  const handler = async (request: Request, env?: unknown, executionContext?: unknown): Promise<Response> => {
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

    const apiRequest: ApiRequest = {
      method: request.method,
      path,
      searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),
      queryString: () => (queryIndex === -1 ? '' : url.slice(queryIndex + 1)),
      header: (name) => request.headers.get(name) ?? undefined,
      readBody:
        maxBodyBytes === undefined
          ? () => request.json()
          : () => readTextCapped(request, maxBodyBytes).then((text) => JSON.parse(text) as unknown),
      readText: maxBodyBytes === undefined ? () => request.text() : () => readTextCapped(request, maxBodyBytes),
      readBytes:
        maxBodyBytes === undefined
          ? () => request.arrayBuffer().then((buffer) => new Uint8Array(buffer))
          : () => readBytesCapped(request.body, request.headers.get('content-length'), maxBodyBytes),
      signal: request.signal,
    }
    const response = await api.handle(apiRequest, env, executionContext)

    // Raw statuses (contract-declared contentType) pass the body straight to
    // the Response constructor: a string, bytes, or a live ReadableStream.
    if (response.contentType !== undefined) {
      return new Response((response.body ?? null) as StreamingBody | null, {
        status: response.status,
        headers: { 'content-type': response.contentType, ...response.headers },
      })
    }
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

  if (onRequest.length === 0 && onResponse.length === 0) return handler

  return async (request: Request, env?: unknown, executionContext?: unknown): Promise<Response> => {
    for (const gate of onRequest) {
      const early = await gate(request, env, executionContext)
      if (early !== undefined) return finish(early, request)
    }
    return finish(await handler(request, env, executionContext), request)
  }
}

/** Shared across every response with a JSON body and no custom headers. */
const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'content-type': 'application/json' })

const toArray = <T>(value: T | ReadonlyArray<T> | undefined): ReadonlyArray<T> =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as T]

const readTextCapped = (request: Request, limit: number): Promise<string> =>
  readBytesCapped(request.body, request.headers.get('content-length'), limit).then((bytes) => DECODER.decode(bytes))

const DECODER = new TextDecoder()
