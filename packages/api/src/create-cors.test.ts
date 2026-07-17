import { describe, expect, it } from 'vitest'

import { createCors } from './create-cors'

const preflight = (origin: string, method = 'POST', requestHeaders?: string): Request =>
  new Request('http://localhost/chat', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      ...(requestHeaders === undefined ? {} : { 'access-control-request-headers': requestHeaders }),
    },
  })

describe('create-cors', () => {
  it('answers a preflight for an allowed origin', async () => {
    const cors = createCors({ origin: 'https://app.example', maxAge: 600 })
    const response = await cors.onRequest(
      preflight('https://app.example', 'POST', 'content-type,x-api-key'),
      undefined,
      undefined,
      {},
    )
    expect(response?.status).toBe(204)
    expect(response?.headers.get('access-control-allow-origin')).toBe('https://app.example')
    expect(response?.headers.get('access-control-allow-methods')).toContain('POST')
    // No allowHeaders configured — the browser's ask is reflected back.
    expect(response?.headers.get('access-control-allow-headers')).toBe('content-type,x-api-key')
    expect(response?.headers.get('access-control-max-age')).toBe('600')
  })

  it('lets a preflight from a denied origin fall through to routing', async () => {
    const cors = createCors({ origin: 'https://app.example' })
    expect(await cors.onRequest(preflight('https://evil.example'), undefined, undefined, {})).toBeUndefined()
  })

  it('ignores plain OPTIONS requests that are not preflights', async () => {
    const cors = createCors({ origin: '*' })
    const plain = new Request('http://localhost/chat', { method: 'OPTIONS' })
    expect(await cors.onRequest(plain, undefined, undefined, {})).toBeUndefined()
  })

  it('decorates responses for allowed origins with credentials and exposed headers', async () => {
    const cors = createCors({
      origin: ['https://app.example', 'https://admin.example'],
      credentials: true,
      exposeHeaders: ['x-demo-used', 'x-demo-max'],
    })
    const request = new Request('http://localhost/chat', { headers: { origin: 'https://admin.example' } })
    const response = (await cors.onResponse(new Response('{}', { status: 200 }), request, {})) as Response
    expect(response.headers.get('access-control-allow-origin')).toBe('https://admin.example')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-expose-headers')).toBe('x-demo-used,x-demo-max')
    expect(response.headers.get('vary')).toBe('origin')
  })

  it('supports a reflecting origin function', async () => {
    const cors = createCors({ origin: (origin) => (origin.endsWith('.example') ? origin : undefined) })
    const allowed = new Request('http://localhost/x', { headers: { origin: 'https://any.example' } })
    const response = (await cors.onResponse(new Response(null), allowed, {})) as Response
    expect(response.headers.get('access-control-allow-origin')).toBe('https://any.example')
  })

  it('adds vary but no allow-origin for a denied origin', async () => {
    const cors = createCors({ origin: 'https://app.example' })
    const request = new Request('http://localhost/x', { headers: { origin: 'https://evil.example' } })
    const response = (await cors.onResponse(new Response(null), request, {})) as Response
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    // Caches must still know the answer depends on the origin header.
    expect(response.headers.get('vary')).toBe('origin')
  })

  it('preserves an existing vary header instead of clobbering it', async () => {
    const cors = createCors({ origin: (origin) => origin })
    const request = new Request('http://localhost/x', { headers: { origin: 'https://a.example' } })
    const original = new Response(null, { headers: { vary: 'accept-encoding' } })
    const response = (await cors.onResponse(original, request, {})) as Response
    expect(response.headers.get('vary')).toBe('accept-encoding, origin')
  })

  it('leaves wildcard responses untouched when no origin header is present', async () => {
    const cors = createCors({ origin: '*' })
    const request = new Request('http://localhost/x')
    const response = new Response(null)
    expect(await cors.onResponse(response, request, {})).toBeUndefined()
  })

  it('sends the literal wildcard for origin *', async () => {
    const cors = createCors({ origin: '*' })
    const request = new Request('http://localhost/x', { headers: { origin: 'https://anyone.example' } })
    const response = (await cors.onResponse(new Response(null), request, {})) as Response
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    // A wildcard answer does not vary by origin.
    expect(response.headers.get('vary')).toBeNull()
  })
})
