import { describe, expect, it } from 'vitest'

import { createETag } from './create-etag'

const get = (headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/resource', { method: 'GET', headers })

describe('create-etag', () => {
  it('adds a strong etag to a safe-method 200 and preserves the body', async () => {
    const etag = createETag()
    const decorated = (await etag(Response.json({ hello: 'world' }), get(), {})) as Response
    expect(decorated.headers.get('etag')).toMatch(/^"[0-9a-f]{8}"$/)
    expect(await decorated.json()).toEqual({ hello: 'world' })
  })

  it('returns 304 when if-none-match matches', async () => {
    const etag = createETag()
    // First pass to learn the etag.
    const first = (await etag(Response.json({ n: 1 }), get(), {})) as Response
    const tag = first.headers.get('etag') ?? ''

    const second = (await etag(Response.json({ n: 1 }), get({ 'if-none-match': tag }), {})) as Response
    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
    expect(second.headers.get('etag')).toBe(tag)
    expect(second.headers.has('content-length')).toBe(false)
  })

  it('leaves non-200 and unsafe methods alone', async () => {
    const etag = createETag()
    expect(await etag(Response.json({}, { status: 201 }), get(), {})).toBeUndefined()
    expect(
      await etag(Response.json({}), new Request('http://localhost/resource', { method: 'POST' }), {}),
    ).toBeUndefined()
  })

  it('does not overwrite an etag the handler already set', async () => {
    const etag = createETag()
    const response = Response.json({}, { headers: { etag: '"handler"' } })
    expect(await etag(response, get(), {})).toBeUndefined()
  })

  it('skips streaming (event-stream) responses', async () => {
    const etag = createETag()
    const sse = new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } })
    expect(await etag(sse, get(), {})).toBeUndefined()
  })

  it('passes through bodies larger than maxBytes without a 304', async () => {
    const etag = createETag({ maxBytes: 4 })
    const big = new Response('a much longer body than four bytes', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
    const result = (await etag(big, get(), {})) as Response
    expect(result.headers.has('etag')).toBe(false)
  })
})
