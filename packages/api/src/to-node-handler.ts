import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Api } from './types'

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
  return async (incoming, outgoing, next) => {
    const target = incoming.url ?? '/'
    const queryIndex = target.indexOf('?')
    const path = queryIndex === -1 ? target : target.slice(0, queryIndex)
    const method = (incoming.method ?? 'GET').toUpperCase()

    if (next !== undefined && !api.matches(method, path)) {
      next()
      return
    }

    const response = await api.handle(
      {
        method,
        path,
        searchParams: () => new URLSearchParams(queryIndex === -1 ? '' : target.slice(queryIndex + 1)),
        header: (name) => {
          const value = incoming.headers[name]
          return Array.isArray(value) ? value[0] : value
        },
        readBody: () => readJsonBody(incoming),
      },
      options?.env,
    )

    const headers: Record<string, string> = { ...response.headers }
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

const readJsonBody = (incoming: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    incoming.on('error', reject)
  })
