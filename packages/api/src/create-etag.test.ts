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

  it('gives distinct binary bodies distinct etags (no U+FFFD collision)', async () => {
    const etag = createETag()
    // Two different single-byte bodies that both decode to U+FFFD as text —
    // hashing the decoded string would collide them onto one strong etag.
    const first = (await etag(
      new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/octet-stream' } }),
      get(),
      {},
    )) as Response
    const second = (await etag(
      new Response(new Uint8Array([0xfe]), { headers: { 'content-type': 'application/octet-stream' } }),
      get(),
      {},
    )) as Response
    expect(first.headers.get('etag')).not.toBe(second.headers.get('etag'))
  })

  it('does not serve a 304 for a changed binary body under the old etag', async () => {
    const etag = createETag()
    const original = (await etag(
      new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/octet-stream' } }),
      get(),
      {},
    )) as Response
    const tag = original.headers.get('etag') ?? ''
    // The resource changed to a different byte; the stale etag must not match.
    const changed = (await etag(
      new Response(new Uint8Array([0xfe]), { headers: { 'content-type': 'application/octet-stream' } }),
      get({ 'if-none-match': tag }),
      {},
    )) as Response
    expect(changed.status).toBe(200)
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

  it('stops reading an oversized stream instead of buffering it whole', async () => {
    // The `content-length` pre-check cannot fire on an adapter-built streaming
    // reply (`new Response(stream).headers.get('content-length')` is null), so
    // the read itself has to respect maxBytes — otherwise a huge body is fully
    // buffered just to discover it was over the limit.
    const etag = createETag({ maxBytes: 1024 })
    const chunk = new Uint8Array(64 * 1024)
    let chunksPulled = 0
    let produced = 0
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        chunksPulled++
        if (produced >= 8_000_000) {
          controller.close()
          return
        }
        produced += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const response = new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    expect(response.headers.get('content-length')).toBe(null)

    const result = (await etag(response, get(), {})) as Response
    // One chunk already blows the 1 KiB budget; nothing near the 8 MB body is
    // read before the decorator bails.
    expect(chunksPulled).toBeLessThan(4)
    expect(result.headers.has('etag')).toBe(false)

    // The bail-out must not eat the chunks it already read: the client still
    // receives the complete body.
    const bytes = new Uint8Array(await result.arrayBuffer())
    expect(bytes.byteLength).toBe(produced)
    expect(produced).toBeGreaterThan(8_000_000)
  })

  it('cancels the source stream when an oversized passthrough is abandoned', async () => {
    const etag = createETag({ maxBytes: 8 })
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(64)),
      cancel: () => {
        cancelled = true
      },
    })
    const result = (await etag(new Response(body, { status: 200 }), get(), {})) as Response
    await result.body?.cancel()
    expect(cancelled).toBe(true)
  })

  it('answers 304 against a handler-supplied etag without buffering the body', async () => {
    // A handler that knows its own version does not need one computed, but it
    // is still owed the conditional half — otherwise the client downloads the
    // body it just proved it already held.
    const etag = createETag()
    const versioned = (): Response =>
      new Response('{"a":1}', { headers: { 'content-type': 'application/json', etag: '"v7"' } })

    const matched = (await etag(
      versioned(),
      new Request('http://x/', { headers: { 'if-none-match': 'W/"v7"' } }),
      {},
    )) as Response
    expect(matched.status).toBe(304)
    expect(matched.headers.get('etag')).toBe('"v7"')
    expect(await matched.text()).toBe('')

    // A non-matching (or absent) validator leaves the response exactly alone.
    expect(
      await etag(versioned(), new Request('http://x/', { headers: { 'if-none-match': '"v6"' } }), {}),
    ).toBeUndefined()
    expect(await etag(versioned(), new Request('http://x/'), {})).toBeUndefined()
  })
})
