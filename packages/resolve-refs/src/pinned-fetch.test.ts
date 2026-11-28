import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { createPinnedFetch, type ResolveHost } from './pinned-fetch'

const servers: Server[] = []

/** Starts a server on loopback and returns its port. */
const listen = async (handler: RequestListener): Promise<number> => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

/**
 * A resolver that points every name at loopback and records what it was asked.
 * `pinned-fetch` dials whatever its resolver returns — vetting is the caller's
 * job — so loopback lets these tests reach a local server under a fake name.
 */
const recordingResolver = (): { resolveHost: ResolveHost; asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    resolveHost: (hostname) => {
      asked.push(hostname)
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }])
    },
  }
}

const init = (): { redirect: 'manual'; signal: AbortSignal } => ({
  redirect: 'manual',
  signal: AbortSignal.timeout(5_000),
})

describe('pinned-fetch', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  })

  it('dials the address the resolver returned and keeps the name in the Host header', async () => {
    let host: string | undefined
    const port = await listen((request, response) => {
      host = request.headers.host
      response.setHeader('content-type', 'application/json')
      response.end('{"ok":true}')
    })
    const { resolveHost, asked } = recordingResolver()

    const response = await createPinnedFetch(resolveHost)(`http://schemas.example.test:${port}/a.json?v=1`, init())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ ok: true })
    expect(host).toBe(`schemas.example.test:${port}`)
    // One resolution, and it is the one the socket used: nothing else resolved
    // the name, so there was no second answer for a rebinding record to change.
    expect(asked).toEqual(['schemas.example.test'])
  })

  it('refuses to connect when the resolver rejects', async () => {
    let hits = 0
    const port = await listen((_request, response) => {
      hits++
      response.end('{}')
    })
    const refuse: ResolveHost = () => Promise.reject(new Error('host resolves to the non-public address 127.0.0.1'))

    await expect(createPinnedFetch(refuse)(`http://rebind.example.test:${port}/`, init())).rejects.toThrow(
      /non-public address 127\.0\.0\.1/,
    )
    expect(hits).toBe(0)
  })

  it('refuses a URL that includes credentials', async () => {
    let hits = 0
    const port = await listen((_request, response) => {
      hits++
      response.end('{}')
    })
    const { resolveHost, asked } = recordingResolver()

    await expect(
      createPinnedFetch(resolveHost)(`http://user:secret@schemas.example.test:${port}/`, init()),
    ).rejects.toThrow(/includes credentials/)
    expect(hits).toBe(0)
    expect(asked).toEqual([])
  })

  it('returns a redirect without following it', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      response.end()
    })
    const { resolveHost, asked } = recordingResolver()

    const response = await createPinnedFetch(resolveHost)(`http://schemas.example.test:${port}/`, init())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data/')
    expect(asked).toEqual(['schemas.example.test'])
  })

  it('gives a 204 response a null body', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(204)
      response.end()
    })
    const { resolveHost } = recordingResolver()

    const response = await createPinnedFetch(resolveHost)(`http://schemas.example.test:${port}/`, init())

    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('sends the caller headers and asks for an uncompressed body', async () => {
    let headers: IncomingHttpHeaders = {}
    const port = await listen((request, response) => {
      headers = request.headers
      response.end('{}')
    })
    const { resolveHost } = recordingResolver()

    await createPinnedFetch(resolveHost)(`http://schemas.example.test:${port}/`, {
      ...init(),
      // `http.request` does not decode bodies, so a caller asking for gzip must
      // not get one it cannot read.
      headers: { authorization: 'Bearer token', 'Accept-Encoding': 'gzip' },
    })

    expect(headers.authorization).toBe('Bearer token')
    expect(headers['accept-encoding']).toBe('identity')
  })

  it('aborts when the signal fires', async () => {
    // Never answers, so only the signal can end the request.
    const port = await listen(() => undefined)
    const { resolveHost } = recordingResolver()

    await expect(
      createPinnedFetch(resolveHost)(`http://schemas.example.test:${port}/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(50),
      }),
    ).rejects.toThrow(/abort|timeout/i)
  })
})
