import type { IncomingMessage, ServerResponse } from 'node:http'
import { validateHeaderName, validateHeaderValue } from 'node:http'

import { payloadTooLargeError } from './payload-too-large'
import type { Api, ApiRequest } from './types'

/**
 * A Node request listener that also works as Express/Connect middleware: when
 * a `next` callback is supplied and the API has no matching route, the request
 * is passed along instead of answered with a 404.
 */
export type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: (error?: unknown) => void,
) => Promise<void>

/**
 * Options for {@link toNodeHandler}.
 */
export type NodeHandlerOptions = {
  /**
   * Passed to the `createApi({ context })` factory as `env` on every request.
   * Node has no per-request platform bindings, so this is a fixed value —
   * typically `process.env` or an app config object.
   */
  readonly env?: unknown
  /**
   * Rejects request bodies larger than this many bytes with a 413, checked
   * against the declared `content-length` up front and enforced while the
   * body streams in. Applies to the pipeline's own body parsing and to
   * handler-initiated `readText`/`readBytes` calls alike. Unset means no
   * limit.
   */
  readonly maxBodyBytes?: number
}

/**
 * Wraps an API in a Node `http` request listener — usable directly with
 * `http.createServer`, mounted as Express/Connect middleware, or attached to
 * Fastify via its raw request hooks.
 *
 * The query string is split off with `indexOf` and only parsed into
 * `URLSearchParams` if a matched route declares a query schema, and the body
 * stream is only consumed when a body schema exists — the laziness of
 * `ApiRequest` maps straight onto Node streams.
 *
 * Deliberately minimal compared to `toFetchHandler`: no `mounts`, `onRequest`,
 * or `onResponse` here (so `createCors` does not apply), because every Node
 * framework this adapter plugs into already has a middleware chain for CORS,
 * rate limits, and security headers — Express/Connect middleware runs before
 * this handler, and plain `node:http` users can wrap the returned listener.
 *
 * @example
 * ```typescript
 * // node:http
 * http.createServer(toNodeHandler(api)).listen(3000)
 *
 * // Express — unmatched paths fall through to the rest of the app
 * app.use(toNodeHandler(api))
 * ```
 */
export const toNodeHandler = (api: Api, options?: NodeHandlerOptions): NodeHandler => {
  const maxBodyBytes = options?.maxBodyBytes
  return async (incoming, outgoing, next) => {
    const target = incoming.url ?? '/'
    const queryIndex = target.indexOf('?')
    const path = queryIndex === -1 ? target : target.slice(0, queryIndex)
    const method = (incoming.method ?? 'GET').toUpperCase()

    if (next !== undefined && !api.matches(method, path)) {
      next()
      return
    }

    try {
      // Client disconnects surface as the response closing before it finished
      // writing. The controller is created lazily so requests whose handlers
      // never look at `signal` do not pay for one.
      let controller: AbortController | undefined
      // All three readers share one buffered read: a Node stream emits its
      // data once, so a second uncached read would wait on 'end' forever —
      // hanging any handler that reads the body after the pipeline already
      // consumed a declared body schema, or that simply reads twice.
      let bytes: Promise<Buffer> | undefined
      const readAll = (): Promise<Buffer> => (bytes ??= readBytes(incoming, maxBodyBytes))
      const request: ApiRequest = {
        method,
        path,
        searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : target.slice(queryIndex + 1)),
        queryString: () => (queryIndex === -1 ? '' : target.slice(queryIndex + 1)),
        header: (name) => {
          const value = incoming.headers[name]
          return Array.isArray(value) ? value[0] : value
        },
        readBody: () => readAll().then((buffer) => JSON.parse(buffer.toString('utf8')) as unknown),
        readText: () => readAll().then((buffer) => buffer.toString('utf8')),
        readBytes: () => readAll().then((buffer) => new Uint8Array(buffer)),
        get signal(): AbortSignal {
          if (controller === undefined) {
            controller = new AbortController()
            outgoing.once('close', () => {
              if (!outgoing.writableFinished) controller?.abort()
            })
          }
          return controller.signal
        },
      }

      const response = await api.handle(request, options?.env)

      const headers: Record<string, string> = { ...response.headers }
      // Handler-supplied headers are validated up front: a writeHead that
      // throws mid-serialization leaves the ServerResponse unrecoverable
      // (statusMessage and body suppression latch), so the 500 boundary below
      // could never answer. Validated here, the throw happens while recovery
      // is still possible.
      if (response.headers !== undefined) {
        for (const [name, value] of Object.entries(headers)) {
          validateHeaderName(name)
          validateHeaderValue(name, value)
        }
      }
      // HEAD answers carry the status and headers the (GET) pipeline produced
      // with no body (RFC 9110) — content-type reflects what GET would have
      // sent, and a streaming body is cancelled since nothing will pump it.
      if (method === 'HEAD') {
        const body: unknown = response.body
        if (body instanceof ReadableStream) void body.cancel().catch(() => undefined)
        if (headers['content-type'] === undefined) {
          if (response.contentType !== undefined) headers['content-type'] = response.contentType
          else if (body !== undefined) headers['content-type'] = 'application/json'
        }
        outgoing.writeHead(response.status, headers)
        outgoing.end()
        return
      }
      // Raw statuses (contract-declared contentType) skip JSON serialization:
      // strings and bytes are written as-is, and a ReadableStream is pumped
      // chunk by chunk so the client sees data as the handler produces it.
      if (response.contentType !== undefined) {
        if (headers['content-type'] === undefined) headers['content-type'] = response.contentType
        outgoing.writeHead(response.status, headers)
        const body = response.body
        if (body === undefined || body === null) {
          outgoing.end()
        } else if (typeof body === 'string' || body instanceof Uint8Array) {
          outgoing.end(body)
        } else {
          try {
            for await (const chunk of body as ReadableStream<Uint8Array>) {
              outgoing.write(chunk)
            }
            outgoing.end()
          } catch {
            // The stream failed mid-flight; the status line is already sent,
            // so the only honest option is to drop the connection.
            outgoing.destroy()
          }
        }
        return
      }
      if (response.body === undefined) {
        outgoing.writeHead(response.status, headers)
        outgoing.end()
        return
      }
      const payload = JSON.stringify(response.body)
      if (headers['content-type'] === undefined) headers['content-type'] = 'application/json'
      // A known length keeps Node off chunked transfer encoding for what is
      // always a fully-buffered JSON payload.
      headers['content-length'] = String(Buffer.byteLength(payload))
      outgoing.writeHead(response.status, headers)
      outgoing.end(payload)
    } catch {
      // A failure past the pipeline — writeHead on an invalid header name,
      // JSON.stringify on a circular reply body, a throwing onError — would
      // otherwise escape as an unhandled rejection and take the process (or
      // silently leak the socket). Answer 500 while the status line is
      // unsent; once bytes are on the wire, hanging up is the honest option.
      if (outgoing.headersSent) {
        outgoing.destroy()
        return
      }
      try {
        outgoing.writeHead(500, { 'content-type': 'application/json' })
        outgoing.end('{"error":"internal_error"}')
      } catch {
        outgoing.destroy()
      }
    }
  }
}

const readBytes = (incoming: IncomingMessage, limit: number | undefined): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (limit !== undefined) {
      const declared = Number(incoming.headers['content-length'])
      if (Number.isFinite(declared) && declared > limit) {
        reject(payloadTooLargeError(limit))
        return
      }
    }
    const chunks: Buffer[] = []
    let total = 0
    incoming.on('data', (chunk: Buffer) => {
      total += chunk.byteLength
      if (limit !== undefined && total > limit) {
        // Stop consuming and tear the socket down — the client is mid-upload
        // and nothing will ever read the rest.
        incoming.destroy()
        reject(payloadTooLargeError(limit))
        return
      }
      chunks.push(chunk)
    })
    incoming.on('end', () => resolve(Buffer.concat(chunks)))
    incoming.on('error', reject)
  })
