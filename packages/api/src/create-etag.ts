import { fnv1aHexBytes } from './fnv1a-hex'
import { matchesIfNoneMatch } from './matches-if-none-match'
import type { FetchOnResponse } from './to-fetch-handler'

/**
 * Options for {@link createETag}.
 */
export type ETagOptions = {
  /**
   * Largest body (in bytes) to buffer and hash. Bodies over this pass through
   * untouched — hashing a huge payload to save one round trip is a bad trade.
   * Defaults to 1 MiB.
   */
  readonly maxBytes?: number
  /**
   * Compute the hash. Defaults to FNV-1a (no crypto dependency, Workers-safe).
   * Swap in a stronger digest if collisions across your payloads matter more
   * than the extra cost.
   */
  readonly hash?: (body: Uint8Array) => string
}

const SAFE = new Set(['GET', 'HEAD'])

/**
 * Automatic entity tags and conditional-GET handling — the ETag/`If-None-Match`
 * dance Rails, Fastify (`@fastify/etag`), and Hono all offer. On a safe-method
 * `200` with a buffered body, the decorator hashes the bytes, sets a strong
 * `ETag`, and — when the request's `If-None-Match` already matches — replaces
 * the reply with a bodyless `304`, saving the client the download.
 *
 * It buffers the response body to hash it, so it is opt-in per app rather than
 * always-on: skip it on routes that stream (it never touches a
 * `text/event-stream` reply), and cap it with `maxBytes` on large payloads.
 * Responses that already carry an `ETag` (a handler that knows its own version)
 * are left alone.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, { onResponse: [createETag()] })
 * ```
 */
export const createETag = (options?: ETagOptions): FetchOnResponse => {
  const maxBytes = options?.maxBytes ?? 1_048_576
  const hash = options?.hash ?? fnv1aHexBytes

  return async (response, request) => {
    if (response.status !== 200 || !SAFE.has(request.method)) return undefined
    if (response.headers.has('etag')) return undefined
    // A streamed reply has no bytes to hash without draining it, which would
    // defeat streaming — and hashing an SSE feed is meaningless anyway.
    if (response.headers.get('content-type')?.includes('text/event-stream')) return undefined
    if (response.body === null) return undefined

    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > maxBytes) return undefined

    // Buffer once. `response.body` cannot be read twice, so the rebuilt
    // response below reuses these exact bytes.
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const etag = `"${hash(bytes)}"`
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch !== null && matchesIfNoneMatch(ifNoneMatch, etag)) {
      // 304 keeps the validators and cache directives, drops the body and its
      // content-length (a 304 must not carry one).
      const headers = new Headers(response.headers)
      headers.set('etag', etag)
      headers.delete('content-length')
      return new Response(null, { status: 304, headers })
    }

    const headers = new Headers(response.headers)
    headers.set('etag', etag)
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers })
  }
}
