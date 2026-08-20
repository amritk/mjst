import { describe, expect, it } from 'vitest'

import { multipartBoundary, streamMultipart } from './stream-multipart'

const BOUNDARY = 'X-BOUND'
const CT = `multipart/form-data; boundary=${BOUNDARY}`

/** Assembles a raw multipart body from field/file parts. */
const buildBody = (parts: Array<{ headers: string; body: string }>): string => {
  let raw = ''
  for (const part of parts) raw += `--${BOUNDARY}\r\n${part.headers}\r\n\r\n${part.body}\r\n`
  raw += `--${BOUNDARY}--\r\n`
  return raw
}

/** A stream that emits the given bytes `chunkSize` at a time (1 = worst case for boundary splits). */
const streamOf = (text: string, chunkSize: number): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

const collect = async (part: { data: AsyncIterableIterator<Uint8Array> }): Promise<string> => {
  const decoder = new TextDecoder()
  let out = ''
  for await (const chunk of part.data) out += decoder.decode(chunk, { stream: true })
  return out + decoder.decode()
}

/**
 * A body that keeps producing until it is cancelled — a client still
 * uploading. A source that closes itself cannot observe a cancel (the stream
 * is already closed by then), so the leak these tests are about is invisible
 * against `streamOf`.
 */
const liveStream = (text: string): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } => {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.subarray(offset, offset + 8))
        offset += 8
        return
      }
      controller.enqueue(new TextEncoder().encode('x'.repeat(64)))
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, cancelled: () => cancelled }
}

describe('multipartBoundary', () => {
  it('extracts a bare and a quoted boundary', () => {
    expect(multipartBoundary('multipart/form-data; boundary=abc')).toBe('abc')
    expect(multipartBoundary('multipart/form-data; boundary="a b c"')).toBe('a b c')
  })

  it('throws when no boundary is present', () => {
    expect(() => multipartBoundary('multipart/form-data')).toThrow(/boundary/)
  })
})

describe('streamMultipart', () => {
  it('parses fields and files with their metadata', async () => {
    const raw = buildBody([
      { headers: 'Content-Disposition: form-data; name="title"', body: 'Hello' },
      {
        headers: 'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'file-contents',
      },
    ])
    const parts: Array<{
      name: string
      filename?: string | undefined
      contentType?: string | undefined
      body: string
    }> = []
    for await (const part of streamMultipart(streamOf(raw, 64), CT)) {
      parts.push({ name: part.name, filename: part.filename, contentType: part.contentType, body: await collect(part) })
    }
    expect(parts).toEqual([
      { name: 'title', filename: undefined, contentType: undefined, body: 'Hello' },
      { name: 'file', filename: 'a.txt', contentType: 'text/plain', body: 'file-contents' },
    ])
  })

  it('reassembles a body split across single-byte chunks', async () => {
    const raw = buildBody([{ headers: 'Content-Disposition: form-data; name="f"', body: 'the quick brown fox' }])
    const bodies: string[] = []
    for await (const part of streamMultipart(streamOf(raw, 1), CT)) bodies.push(await collect(part))
    expect(bodies).toEqual(['the quick brown fox'])
  })

  it('preserves binary content containing CRLFs that are not the delimiter', async () => {
    const payload = 'line1\r\nline2\r\n--not-the-boundary\r\nline3'
    const raw = buildBody([{ headers: 'Content-Disposition: form-data; name="f"', body: payload }])
    for await (const part of streamMultipart(streamOf(raw, 3), CT)) {
      expect(await collect(part)).toBe(payload)
    }
  })

  it('drains an unconsumed part so the next one still parses', async () => {
    const raw = buildBody([
      { headers: 'Content-Disposition: form-data; name="skipme"', body: 'ignored'.repeat(100) },
      { headers: 'Content-Disposition: form-data; name="keep"', body: 'value' },
    ])
    const seen: string[] = []
    for await (const part of streamMultipart(streamOf(raw, 16), CT)) {
      // Deliberately do not read part.data for the first part.
      if (part.name === 'keep') seen.push(await collect(part))
      else seen.push(part.name)
    }
    expect(seen).toEqual(['skipme', 'value'])
  })

  it('exposes every header line', async () => {
    const raw = buildBody([{ headers: 'Content-Disposition: form-data; name="f"\r\nX-Custom: yes', body: 'x' }])
    for await (const part of streamMultipart(streamOf(raw, 8), CT)) {
      expect(part.headers['x-custom']).toBe('yes')
    }
  })

  it('throws on a truncated body with no closing boundary', async () => {
    const truncated = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"\r\n\r\nunterminated`
    await expect(async () => {
      for await (const part of streamMultipart(streamOf(truncated, 8), CT)) await collect(part)
    }).rejects.toThrow(/unterminated/)
  })

  it('throws when the opening boundary never appears', async () => {
    await expect(async () => {
      for await (const _ of streamMultipart(streamOf('no boundary here at all', 8), CT)) {
        // no-op
      }
    }).rejects.toThrow(/opening boundary/)
  })
  it('cancels the request body when the consumer stops after the part it wanted', async () => {
    // A handler that finds its file and returns must not leave the client
    // uploading into a buffer nobody reads: abandoning the generator has to
    // reach the source.
    const { stream, cancelled } = liveStream(
      buildBody([
        { headers: 'Content-Disposition: form-data; name="a"', body: 'AAA' },
        { headers: 'Content-Disposition: form-data; name="b"', body: 'BBB' },
      ]),
    )
    for await (const part of streamMultipart(stream, CT)) {
      expect(part.name).toBe('a')
      break
    }
    expect(cancelled()).toBe(true)
  })

  it('cancels the request body when a part handler throws', async () => {
    const { stream, cancelled } = liveStream(
      buildBody([{ headers: 'Content-Disposition: form-data; name="a"', body: 'AAA' }]),
    )
    await expect(async () => {
      for await (const part of streamMultipart(stream, CT)) {
        void part
        throw new Error('upload rejected')
      }
    }).rejects.toThrow('upload rejected')
    expect(cancelled()).toBe(true)
  })

  it('cancels the request body after the closing delimiter', async () => {
    // The epilogue belongs to no part, and the lock has to come off either
    // way — a fully-consumed body releases the stream like an abandoned one.
    const { stream, cancelled } = liveStream(
      buildBody([{ headers: 'Content-Disposition: form-data; name="a"', body: 'AAA' }]),
    )
    const seen: string[] = []
    for await (const part of streamMultipart(stream, CT)) seen.push(`${part.name}=${await collect(part)}`)
    expect(seen).toEqual(['a=AAA'])
    expect(cancelled()).toBe(true)
  })
})
