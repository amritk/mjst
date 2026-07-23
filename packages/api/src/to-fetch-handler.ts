import { buildResponseHeaders } from './build-response-headers'
import { DEFAULT_MAX_BODY_BYTES } from './payload-too-large'
import { readBodyCapped } from './read-body-capped'
import type { Api, ApiRequest, ApiResponse, RequestLocals, StreamingBody } from './types'

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
 *
 * `locals` is the per-request {@link RequestLocals} bag, shared with later
 * gates, the context factory, handlers (`request.locals`), and `onResponse`
 * decorators — how an auth gate hands its resolved tenant to the handler
 * instead of resolving it twice. `env` and `executionContext` are typed
 * `unknown` (not optional) so hooks that ignore them keep their old
 * signatures while `locals` stays non-optional.
 */
export type FetchOnRequest = (
  request: Request,
  env: unknown,
  executionContext: unknown,
  locals: RequestLocals,
) => Response | undefined | Promise<Response | undefined>

/**
 * A response decorator, run on every outgoing response — routed replies,
 * mount replies, 404s, and gate short-circuits alike. Mutate the response's
 * headers in place and return nothing, or return a replacement `Response`.
 * Runs in array order, so later hooks see earlier hooks' changes. `locals`
 * is the same per-request bag the gates and handler wrote — how a rate-limit
 * gate's computed counters end up stamped onto the outgoing response.
 */
export type FetchOnResponse = (
  response: Response,
  request: Request,
  locals: RequestLocals,
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
   * The platform `env` and `executionContext` the handler was invoked with are
   * passed through too — the shape a per-request env-dependent sub-router needs
   * (Better Auth on Cloudflare Workers reads secrets and the DB URL from
   * `env`, which only exists inside `fetch`):
   *
   * ```typescript
   * toFetchHandler(api, {
   *   mounts: { '/api/auth': (request, env) => makeAuth(env as Env).handler(request) },
   * })
   * ```
   *
   * Mounts still sit inside the hook chains: gates run before them and
   * response decorators after, so a mounted router is not a hole in the
   * app's headers or rate limits. A gate that must not apply to a mount
   * (a CSRF check exempting the auth routes, say) checks the path itself.
   */
  readonly mounts?: Readonly<
    Record<string, (request: Request, env: unknown, executionContext: unknown) => Response | Promise<Response>>
  >
  /** Gate(s) run before mounts and routing, in order. See {@link FetchOnRequest}. */
  readonly onRequest?: FetchOnRequest | ReadonlyArray<FetchOnRequest>
  /** Decorator(s) run on every outgoing response, in order. See {@link FetchOnResponse}. */
  readonly onResponse?: FetchOnResponse | ReadonlyArray<FetchOnResponse>
  /**
   * Rejects request bodies larger than this many bytes with a 413, checked
   * against the declared `content-length` up front and enforced while the
   * body streams in (so a lying or chunked client is still cut off). Applies
   * to the pipeline's own body parsing and to handler-initiated
   * `readText`/`readBytes` calls alike. Defaults to 1 MiB (1,048,576 bytes)
   * — an unbounded read is a memory-DoS by default. Pass `Infinity` to
   * disable the cap entirely.
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
  const maxBodyBytes = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

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

  const finish = async (response: Response, request: Request, locals: RequestLocals): Promise<Response> => {
    let current = response
    for (const hook of onResponse) {
      current = (await hook(current, request, locals)) ?? current
    }
    return current
  }

  const handler = async (
    request: Request,
    env?: unknown,
    executionContext?: unknown,
    sharedLocals?: RequestLocals,
  ): Promise<Response> => {
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
      if (path === prefix || path.startsWith(prefix + '/')) return mount(request, env, executionContext)
    }

    // All three readers share one buffered read, so the body can be read
    // repeatedly and in any combination — a handler calling `readText` after
    // the pipeline consumed a declared body schema would otherwise hit the
    // stream's single-use limit.
    let bytes: Promise<Uint8Array> | undefined
    // An Infinity cap means genuinely unbounded, so it takes the plain
    // arrayBuffer path — no reason to stream-count bytes against a limit
    // nothing can exceed.
    const readAllBytes =
      maxBodyBytes === Number.POSITIVE_INFINITY
        ? () => (bytes ??= request.arrayBuffer().then((buffer) => new Uint8Array(buffer)))
        : () => (bytes ??= readBodyCapped(request, maxBodyBytes))

    // The hook wrapper's shared bag when hooks are configured; otherwise
    // created lazily on first `locals` access, so the zero-hook fast path
    // never allocates for it.
    let locals = sharedLocals
    const apiRequest: ApiRequest = {
      method: request.method,
      path,
      searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1)),
      queryString: () => (queryIndex === -1 ? '' : url.slice(queryIndex + 1)),
      header: (name) => request.headers.get(name) ?? undefined,
      readBody: () => readAllBytes().then((buffer) => JSON.parse(DECODER.decode(buffer)) as unknown),
      readText: () => readAllBytes().then((buffer) => DECODER.decode(buffer)),
      readBytes: readAllBytes,
      signal: request.signal,
      raw: request,
      get locals(): RequestLocals {
        locals ??= {}
        return locals
      },
    }
    const response = await api.handle(apiRequest, env, executionContext)

    // Translating an ApiResponse into a Response can itself throw — a circular
    // reply body breaks JSON.stringify, an invalid header name breaks the
    // Headers constructor — and `onError` never sees it because the handler
    // already returned. Without this boundary the rejection escapes to the
    // platform instead of becoming the pipeline's own 500 shape.
    try {
      if (request.method === 'HEAD') return headResponse(response)

      // A handler that returned a raw web Response (the escape hatch) sends it
      // verbatim — still through the onResponse decorators, since `finish`
      // wraps whatever this handler returns.
      if (response.raw !== undefined) return response.raw

      // Raw statuses (contract-declared contentType) pass the body straight to
      // the Response constructor: a string, bytes, or a live ReadableStream.
      if (response.contentType !== undefined) {
        return new Response((response.body ?? null) as StreamingBody | null, {
          status: response.status,
          headers:
            response.headers === undefined
              ? { 'content-type': response.contentType }
              : buildResponseHeaders(response.headers, response.contentType),
        })
      }
      if (response.headers === undefined) {
        if (response.body === undefined) return new Response(null, { status: response.status })
        return new Response(JSON.stringify(response.body), initFor(response.status))
      }
      if (response.body === undefined) {
        return new Response(null, { status: response.status, headers: buildResponseHeaders(response.headers) })
      }
      // Custom headers win over the default content-type, matching Response.json.
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: buildResponseHeaders(response.headers, 'application/json'),
      })
    } catch {
      return new Response('{"error":"internal_error"}', initFor(500))
    }
  }

  if (onRequest.length === 0 && onResponse.length === 0) return handler

  return async (request: Request, env?: unknown, executionContext?: unknown): Promise<Response> => {
    // One locals bag per request, created before the first gate so every
    // stage — gates, context factory, handler, decorators — shares it.
    const locals: RequestLocals = {}
    for (const gate of onRequest) {
      const early = await gate(request, env, executionContext, locals)
      if (early !== undefined) return finish(early, request, locals)
    }
    return finish(await handler(request, env, executionContext, locals), request, locals)
  }
}

/** Shared across every response with a JSON body and no custom headers. */
const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'content-type': 'application/json' })

const toArray = <T>(value: T | ReadonlyArray<T> | undefined): ReadonlyArray<T> =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as T]

/**
 * A HEAD reply: the status and headers the GET pipeline produced, no body
 * (RFC 9110). Headers match the equivalent GET branch — content-type
 * included — and a streaming body is cancelled rather than leaked, since
 * nothing will ever pump it.
 */
const headResponse = (response: ApiResponse): Response => {
  // A raw Response from the escape hatch: keep its status and headers, drop the
  // body (RFC 9110), and cancel the source stream since nothing will pump it.
  if (response.raw !== undefined) {
    const rawBody = response.raw.body
    if (rawBody !== null) void rawBody.cancel().catch(() => undefined)
    return new Response(null, { status: response.raw.status, headers: response.raw.headers })
  }
  const body: unknown = response.body
  if (body instanceof ReadableStream) void body.cancel().catch(() => undefined)
  if (response.contentType !== undefined) {
    return new Response(null, {
      status: response.status,
      headers:
        response.headers === undefined
          ? { 'content-type': response.contentType }
          : buildResponseHeaders(response.headers, response.contentType),
    })
  }
  if (response.headers === undefined) {
    if (body === undefined) return new Response(null, { status: response.status })
    return new Response(null, { status: response.status, headers: JSON_HEADERS })
  }
  return body === undefined
    ? new Response(null, { status: response.status, headers: buildResponseHeaders(response.headers) })
    : new Response(null, {
        status: response.status,
        headers: buildResponseHeaders(response.headers, 'application/json'),
      })
}

const DECODER = new TextDecoder()
