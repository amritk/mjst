import { describe, expect, it } from 'vitest'

import { isPayloadTooLargeError } from './payload-too-large'
import { readBytesCapped } from './read-bytes-capped'

const streamOf = (...chunks: readonly string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('read-bytes-capped', () => {
  it('reads a body within the limit into one buffer', async () => {
    const bytes = await readBytesCapped(streamOf('hello', ' ', 'world'), null, 100)
    expect(new TextDecoder().decode(bytes)).toBe('hello world')
  })

  it('returns empty bytes for a null body', async () => {
    const bytes = await readBytesCapped(null, null, 10)
    expect(bytes.byteLength).toBe(0)
  })

  it('rejects an oversized declared content-length before reading', async () => {
    // The stream never gets a reader attached — a huge honest upload fails
    // instantly. (The stream itself may still pre-fill its internal queue;
    // what matters is that no reader consumes it.)
    const stream = new ReadableStream<Uint8Array>()
    const error = await readBytesCapped(stream, '1000', 10).catch((caught: unknown) => caught)
    expect(isPayloadTooLargeError(error)).toBe(true)
    expect(stream.locked).toBe(false)
  })

  it('cuts off a stream that exceeds the limit mid-transfer', async () => {
    // No content-length header — the chunked/lying-client case that only the
    // running byte count can catch.
    const error = await readBytesCapped(streamOf('12345', '67890', 'overflow'), null, 8).catch(
      (caught: unknown) => caught,
    )
    expect(isPayloadTooLargeError(error)).toBe(true)
  })

  it('accepts a body exactly at the limit', async () => {
    const bytes = await readBytesCapped(streamOf('12345678'), null, 8)
    expect(bytes.byteLength).toBe(8)
  })

  it('ignores a malformed content-length and trusts the byte count', async () => {
    const bytes = await readBytesCapped(streamOf('ok'), 'not-a-number', 10)
    expect(new TextDecoder().decode(bytes)).toBe('ok')
  })
})
