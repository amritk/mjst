import type { IncomingMessage, ServerResponse } from 'node:http'

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

    // Client disconnects surface as the response closing before it finished
    // writing. The controller is created lazily so requests whose handlers
    // never look at `signal` do not pay for one.
    let controller: AbortController | undefined
    const request: ApiRequest = {
      method,
      path,
      searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : target.slice(queryIndex + 1)),
      queryString: () => (queryIndex === -1 ? '' : target.slice(queryIndex + 1)),
      header: (name) => {
        const value = incoming.headers[name]
        return Array.isArray(value) ? value[0] : value
      },
      readBody: () => readBytes(incoming, maxBodyBytes).then((bytes) => JSON.parse(bytes.toString('utf8')) as unknown),
      readText: () => readBytes(incoming, maxBodyBytes).then((bytes) => bytes.toString('utf8')),
      readBytes: () => readBytes(incoming, maxBodyBytes).then((bytes) => new Uint8Array(bytes)),
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
          // The stream failed mid-flight; the status line is already sent, so
          // the only honest option is to drop the connection.
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
    outgoing.writeHead(response.status, headers)
    outgoing.end(payload)
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
