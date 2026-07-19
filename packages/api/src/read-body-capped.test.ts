import { describe, expect, it } from 'vitest'

import { isPayloadTooLargeError } from './payload-too-large'
import { readBodyCapped } from './read-body-capped'

const streamOf = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

type Source = {
  contentLength?: string
  bytes: Uint8Array
  onArrayBuffer?: () => void
  onStream?: () => void
}

const sourceOf = ({ contentLength, bytes, onArrayBuffer, onStream }: Source) => ({
  headers: { get: (name: string) => (name === 'content-length' ? (contentLength ?? null) : null) },
  get body() {
    onStream?.()
    return streamOf(bytes)
  },
  arrayBuffer: () => {
    onArrayBuffer?.()
    return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  },
})

describe('readBodyCapped', () => {
  it('takes the native arrayBuffer path when the declared length fits the limit', async () => {
    let native = 0
    let streamed = 0
    const bytes = new Uint8Array([1, 2, 3])
    const result = await readBodyCapped(
      sourceOf({ contentLength: '3', bytes, onArrayBuffer: () => native++, onStream: () => streamed++ }),
      10,
    )
    expect(result).toEqual(bytes)
    expect(native).toBe(1)
    expect(streamed).toBe(0)
  })

  it('accepts a body exactly at the limit', async () => {
    const bytes = new Uint8Array(10)
    const result = await readBodyCapped(sourceOf({ contentLength: '10', bytes }), 10)
    expect(result.byteLength).toBe(10)
  })

  it('rejects an oversized declared length before reading anything', async () => {
    let native = 0
    let streamed = 0
    const source = sourceOf({
      contentLength: '11',
      bytes: new Uint8Array(11),
      onArrayBuffer: () => native++,
      onStream: () => streamed++,
    })
    await expect(readBodyCapped(source, 10)).rejects.toSatisfy(isPayloadTooLargeError)
    expect(native).toBe(0)
    expect(streamed).toBe(0)
  })

  it('rejects after the read when a header understates the body', async () => {
    const source = sourceOf({ contentLength: '5', bytes: new Uint8Array(20) })
    await expect(readBodyCapped(source, 10)).rejects.toSatisfy(isPayloadTooLargeError)
  })

  it('falls back to the streaming reader when content-length is absent', async () => {
    let native = 0
    const bytes = new Uint8Array([7, 8])
    const result = await readBodyCapped(sourceOf({ bytes, onArrayBuffer: () => native++ }), 10)
    expect(result).toEqual(bytes)
    expect(native).toBe(0)
  })

  it('falls back to the streaming reader when content-length is unparseable', async () => {
    let native = 0
    const bytes = new Uint8Array([9])
    const result = await readBodyCapped(
      sourceOf({ contentLength: '100, 100', bytes, onArrayBuffer: () => native++ }),
      10,
    )
    expect(result).toEqual(bytes)
    expect(native).toBe(0)
  })

  it('enforces the limit mid-stream on the fallback path', async () => {
    const source = sourceOf({ bytes: new Uint8Array(11) })
    await expect(readBodyCapped(source, 10)).rejects.toSatisfy(isPayloadTooLargeError)
  })
})
