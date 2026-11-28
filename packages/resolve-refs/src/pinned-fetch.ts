import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

import type { PublicAddress } from './resolve-public-host'

/** The subset of `fetch`'s `init` that remote `$ref` resolution sends. */
export type PinnedFetchInit = { redirect: 'manual'; signal: AbortSignal; headers?: Record<string, string> }

/** Resolves a hostname to the only addresses the connection may dial. */
export type ResolveHost = (hostname: string) => Promise<PublicAddress[]>

// The statuses the Fetch spec gives a null body; `new Response` throws if
// handed a stream for one of them.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

/** `LookupOptions.family` also accepts the legacy `'IPv4'` / `'IPv6'` spellings. */
const wantedFamily = (family: number | 'IPv4' | 'IPv6' | undefined): 4 | 6 | undefined => {
  if (family === 4 || family === 'IPv4') return 4
  if (family === 6 || family === 'IPv6') return 6
  return undefined
}

/** Adapts a Node response to the WHATWG `Response` the rest of the resolver reads. */
const toResponse = (message: IncomingMessage): Response => {
  const headers = new Headers()
  for (let i = 0; i + 1 < message.rawHeaders.length; i += 2) {
    headers.append(message.rawHeaders[i] as string, message.rawHeaders[i + 1] as string)
  }
  const status = message.statusCode ?? 0
  if (NULL_BODY_STATUSES.has(status)) {
    message.resume()
    return new Response(null, { status, statusText: message.statusMessage ?? '', headers })
  }
  return new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
    status,
    statusText: message.statusMessage ?? '',
    headers,
  })
}

/**
 * A `fetch` for remote `$ref`s that dials only the addresses `resolveHost`
 * returns, closing the DNS-rebinding hole a check-then-`fetch` guard leaves.
 *
 * Checking a name and then calling `fetch` resolves it twice: once for the
 * check and again inside the socket. A record with a short TTL can answer the
 * first with a public address and the second with `127.0.0.1` or
 * `169.254.169.254`. Node's `fetch` offers no seam to pin the address, but
 * `http.request` does: its `lookup` option *is* the socket's resolver, so
 * running the guard there makes the verified addresses the dialed ones. The
 * host name itself is still what goes on the wire, so `Host`, SNI, and
 * certificate verification are unchanged.
 *
 * `agent: false` gives every request its own socket. A shared agent could hand
 * back a keep-alive socket some other code opened to the same `host:port`
 * without this guard — connected to wherever the name pointed then.
 *
 * Bodies are requested uncompressed (`accept-encoding: identity`) because,
 * unlike `fetch`, `http.request` does not decode them.
 */
export const createPinnedFetch =
  (resolveHost: ResolveHost) =>
  (url: string, init: PinnedFetchInit): Promise<Response> => {
    const target = new URL(url)
    // `fetch` refuses a URL with credentials in it; `http.request` would drop
    // them without a word. Keep `fetch`'s answer.
    if (target.username !== '' || target.password !== '') {
      return Promise.reject(new TypeError(`refusing a URL that includes credentials: ${target.host}`))
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest

    const lookup: LookupFunction = (hostname, options, callback) => {
      resolveHost(hostname).then(
        (addresses) => {
          const family = wantedFamily(options.family)
          const usable = family === undefined ? addresses : addresses.filter((entry) => entry.family === family)
          const first = usable[0]
          if (first === undefined) {
            callback(new Error(`host "${hostname}" has no IPv${family} address`), '', 0)
            return
          }
          if (options.all) callback(null, usable)
          else callback(null, first.address, first.family)
        },
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), '', 0),
      )
    }

    return new Promise<Response>((resolve, reject) => {
      const request = send(
        {
          protocol: target.protocol,
          // IP literals never reach `lookup` (the socket dials them directly);
          // `denialReason` has already vetted those by syntax.
          host: target.hostname.replace(/^\[|\]$/g, ''),
          port: target.port === '' ? undefined : target.port,
          path: `${target.pathname}${target.search}`,
          method: 'GET',
          headers: { accept: '*/*', ...init.headers, 'accept-encoding': 'identity' },
          lookup,
          agent: false,
          signal: init.signal,
        },
        (message) => {
          try {
            resolve(toResponse(message))
          } catch (err) {
            message.destroy()
            reject(err)
          }
        },
      )
      request.on('error', reject)
      request.end()
    })
  }
