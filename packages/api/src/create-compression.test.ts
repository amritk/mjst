import { describe, expect, it } from 'vitest'

import { createCompression } from './create-compression'

const get = (acceptEncoding?: string): Request =>
  new Request('http://localhost/', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  })

const jsonBody = (size: number): Response =>
  new Response(JSON.stringify({ pad: 'x'.repeat(size) }), { headers: { 'content-type': 'application/json' } })

describe('create-compression', () => {
  it('compresses a compressible body when the client accepts gzip', async () => {
    const compress = createCompression({ threshold: 0 })
    const result = (await compress(jsonBody(100), get('gzip'), {})) as Response
    expect(result.headers.get('content-encoding')).toBe('gzip')
    expect(result.headers.has('content-length')).toBe(false)
    expect(result.headers.get('vary')?.toLowerCase()).toContain('accept-encoding')

    // The stream still decompresses to the original bytes.
    const decoded = await new Response(result.body?.pipeThrough(new DecompressionStream('gzip'))).text()
    expect(JSON.parse(decoded)).toEqual({ pad: 'x'.repeat(100) })
  })

  it('skips when the client sends no accept-encoding', async () => {
    const compress = createCompression({ threshold: 0 })
    expect(await compress(jsonBody(100), get(), {})).toBeUndefined()
  })

  it('skips an already-encoded response', async () => {
    const compress = createCompression({ threshold: 0 })
    const encoded = new Response('data', { headers: { 'content-type': 'application/json', 'content-encoding': 'br' } })
    expect(await compress(encoded, get('gzip'), {})).toBeUndefined()
  })

  it('skips bodies below the threshold', async () => {
    const compress = createCompression({ threshold: 1024 })
    const small = new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2' } })
    expect(await compress(small, get('gzip'), {})).toBeUndefined()
  })

  it('skips non-compressible content types', async () => {
    const compress = createCompression({ threshold: 0 })
    const image = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    expect(await compress(image, get('gzip'), {})).toBeUndefined()
  })

  it('honors a no-transform cache directive', async () => {
    const compress = createCompression({ threshold: 0 })
    const response = new Response('{}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-transform' },
    })
    expect(await compress(response, get('gzip'), {})).toBeUndefined()
  })

  it('falls back to deflate when gzip is not offered', async () => {
    const compress = createCompression({ threshold: 0, encodings: ['deflate'] })
    const result = (await compress(jsonBody(50), get('deflate'), {})) as Response
    expect(result.headers.get('content-encoding')).toBe('deflate')
  })

  it('does not use an encoding the client refused with q=0', async () => {
    const compress = createCompression({ threshold: 0, encodings: ['gzip'] })
    // gzip is explicitly unacceptable; nothing else is offered → skip.
    expect(await compress(jsonBody(100), get('gzip;q=0'), {})).toBeUndefined()
  })

  it('honors the encoding the client prefers when it refuses another', async () => {
    const compress = createCompression({ threshold: 0 })
    const result = (await compress(jsonBody(100), get('gzip;q=0, deflate'), {})) as Response
    expect(result.headers.get('content-encoding')).toBe('deflate')
  })

  it('honors a bare * wildcard as accepting any offered encoding', async () => {
    const compress = createCompression({ threshold: 0 })
    const result = (await compress(jsonBody(100), get('*'), {})) as Response
    expect(result.headers.get('content-encoding')).toBe('gzip')
  })

  it('skips a partial response, whose content-range counts identity bytes', async () => {
    const compress = createCompression({ threshold: 0 })
    const partial = new Response(JSON.stringify({ pad: 'x'.repeat(100) }), {
      status: 206,
      headers: { 'content-type': 'application/json', 'content-range': 'bytes 0-99/500' },
    })
    expect(await compress(partial, get('gzip'), {})).toBeUndefined()

    // A 200 that still carries a range header is the same mistake.
    const ranged = new Response(JSON.stringify({ pad: 'x'.repeat(100) }), {
      headers: { 'content-type': 'application/json', 'content-range': 'bytes 0-99/500' },
    })
    expect(await compress(ranged, get('gzip'), {})).toBeUndefined()
  })

  it('weakens a strong ETag on the response it encodes', async () => {
    // The entity-tag names one representation; the encoded bytes are another
    // (RFC 9110 §8.8.1). Weak says "semantically the same", which is true.
    const compress = createCompression({ threshold: 0 })
    const tagged = new Response(JSON.stringify({ pad: 'x'.repeat(100) }), {
      headers: { 'content-type': 'application/json', etag: '"abc123"' },
    })
    const result = (await compress(tagged, get('gzip'), {})) as Response
    expect(result.headers.get('etag')).toBe('W/"abc123"')

    const alreadyWeak = new Response(JSON.stringify({ pad: 'x'.repeat(100) }), {
      headers: { 'content-type': 'application/json', etag: 'W/"abc123"' },
    })
    const second = (await compress(alreadyWeak, get('gzip'), {})) as Response
    expect(second.headers.get('etag')).toBe('W/"abc123"')
  })
})
