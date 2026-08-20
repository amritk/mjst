import type { FetchOnResponse } from './to-fetch-handler'

/**
 * Options for {@link createCompression}.
 */
export type CompressionOptions = {
  /**
   * Content encodings to offer, in preference order. Restricted to what the
   * Web-standard `CompressionStream` implements — `gzip` and `deflate` (Brotli
   * is not in the platform yet). Defaults to `['gzip', 'deflate']`.
   */
  readonly encodings?: ReadonlyArray<'gzip' | 'deflate'>
  /**
   * Smallest response (by `content-length`) worth compressing. Below it the
   * CPU and the framing overhead cost more than the bytes saved. Responses
   * with no declared length (streams) are always eligible. Defaults to 1024.
   */
  readonly threshold?: number
  /**
   * Decides whether a `content-type` is worth compressing. Defaults to the
   * usual text-ish set (json, text, javascript, xml, svg, wasm) — already
   * compressed formats (images, video, zip) only waste CPU.
   */
  readonly filter?: (contentType: string) => boolean
}

const DEFAULT_ENCODINGS: ReadonlyArray<'gzip' | 'deflate'> = ['gzip', 'deflate']

const defaultFilter = (contentType: string): boolean =>
  /(?:json|text\/|javascript|xml|svg|wasm|application\/(?:x-ndjson|manifest))/i.test(contentType)

/**
 * Picks the first offered encoding the client accepts, honoring RFC 9110
 * `q`-weights and the `*` wildcard. A substring test is not enough: it treats
 * `gzip;q=0` (an explicit refusal) as acceptance and misses a bare `*`.
 */
const negotiate = (
  acceptEncoding: string,
  offered: ReadonlyArray<'gzip' | 'deflate'>,
): 'gzip' | 'deflate' | undefined => {
  const weights = new Map<string, number>()
  let wildcard: number | undefined
  for (const part of acceptEncoding.toLowerCase().split(',')) {
    const [token, ...params] = part.split(';').map((segment) => segment.trim())
    if (token === undefined || token === '') continue
    let quality = 1
    for (const param of params) {
      const match = /^q=(.*)$/.exec(param)
      if (match !== null) {
        const parsed = Number(match[1])
        quality = Number.isNaN(parsed) ? 1 : parsed
      }
    }
    if (token === '*') wildcard = quality
    else weights.set(token, quality)
  }
  for (const encoding of offered) {
    const explicit = weights.get(encoding)
    const quality = explicit ?? wildcard
    if (quality !== undefined && quality > 0) return encoding
  }
  return undefined
}

/**
 * Response compression as an `onResponse` hook — the gzip/deflate middleware
 * Fiber, Hono, and every Node framework ship, here built on the platform's
 * `CompressionStream` so it adds no dependency and streams the body through
 * rather than buffering it. It negotiates against `Accept-Encoding`, sets
 * `Content-Encoding`, drops the now-wrong `Content-Length`, and appends
 * `Accept-Encoding` to `Vary` so shared caches keep encodings apart.
 *
 * Skipped for: an already-encoded response, a body under `threshold`, a
 * content-type the filter rejects, a `no-transform` cache directive,
 * `HEAD`/`304`/`204` replies (no body to compress), and partial content — a
 * `206` or anything carrying `content-range`, whose byte range describes the
 * identity representation and would no longer describe the body once it is
 * encoded.
 *
 * A strong `ETag` on a response it compresses is weakened to `W/`, because
 * the entity-tag names one representation and the encoded bytes are a
 * different one (RFC 9110 §8.8.1). Weak is the honest label: the two are
 * semantically equivalent, not byte-identical — the same thing nginx does.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, { onResponse: [createCompression()] })
 * ```
 */
export const createCompression = (options?: CompressionOptions): FetchOnResponse => {
  const encodings = options?.encodings ?? DEFAULT_ENCODINGS
  const threshold = options?.threshold ?? 1024
  const filter = options?.filter ?? defaultFilter

  return (response, request) => {
    if (response.body === null || request.method === 'HEAD') return undefined
    if (response.status === 204 || response.status === 304) return undefined
    if (response.headers.has('content-encoding')) return undefined
    // A partial response's `content-range` counts bytes of the identity
    // representation. Encoding the body leaves the header describing a range
    // the payload no longer has, and the client reassembles garbage.
    if (response.status === 206 || response.headers.has('content-range')) return undefined

    const contentType = response.headers.get('content-type')
    if (contentType === null || !filter(contentType)) return undefined
    // Respect an upstream/handler opt-out and never re-transform.
    if (response.headers.get('cache-control')?.includes('no-transform')) return undefined

    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) < threshold) return undefined

    const accept = request.headers.get('accept-encoding')
    if (accept === null) return undefined
    const encoding = negotiate(accept, encodings)
    if (encoding === undefined) return undefined

    const compressed = response.body.pipeThrough(new CompressionStream(encoding))
    const headers = new Headers(response.headers)
    headers.set('content-encoding', encoding)
    // The compressed length is not known until the stream drains.
    headers.delete('content-length')
    // A strong validator asserts byte-for-byte identity with one
    // representation, and this is a different one. Weakening keeps the
    // validator usable (the two are semantically the same response) without
    // claiming bytes that are no longer being sent.
    const etag = headers.get('etag')
    if (etag !== null && !etag.startsWith('W/')) headers.set('etag', 'W/' + etag)
    appendVary(headers, 'accept-encoding')
    return new Response(compressed, { status: response.status, statusText: response.statusText, headers })
  }
}

/** Adds a token to `Vary` without duplicating one already present. */
const appendVary = (headers: Headers, token: string): void => {
  const existing = headers.get('vary')
  if (existing === null) {
    headers.set('vary', token)
    return
  }
  if (existing === '*') return
  if (
    !existing
      .toLowerCase()
      .split(',')
      .some((value) => value.trim() === token)
  ) {
    headers.set('vary', `${existing}, ${token}`)
  }
}
