import { describe, expect, it } from 'vitest'

import { decodeRealtimeFrames, encodeRealtimeFrame, type RealtimeMessage } from './realtime-framing'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

/** Encodes every message and feeds the result through the decoder in one chunk. */
const roundTrip = (messages: readonly RealtimeMessage[]): readonly RealtimeMessage[] => {
  const frames = messages.map(encodeRealtimeFrame)
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.byteLength
  }
  return decodeRealtimeFrames()(joined)
}

describe('realtime-framing', () => {
  it('round-trips a text message', () => {
    expect(roundTrip(['hello'])).toEqual(['hello'])
  })

  it('round-trips a binary message', () => {
    expect(roundTrip([bytes(1, 2, 3)])).toEqual([bytes(1, 2, 3)])
  })

  it('keeps text and binary distinct, since WebSocket peers check the type', () => {
    // 'abc' and its bytes must not collapse into one representation — a peer
    // branching on `typeof data` would break the moment they did.
    expect(roundTrip(['abc', bytes(97, 98, 99)])).toEqual(['abc', bytes(97, 98, 99)])
  })

  it('round-trips multi-byte UTF-8 intact', () => {
    expect(roundTrip(['héllo → 世界 🎉'])).toEqual(['héllo → 世界 🎉'])
  })

  it('round-trips an empty message', () => {
    expect(roundTrip([''])).toEqual([''])
  })

  it('decodes several messages arriving in one chunk', () => {
    expect(roundTrip(['one', 'two', 'three'])).toEqual(['one', 'two', 'three'])
  })

  it('reassembles a message split across chunks', () => {
    const decode = decodeRealtimeFrames()
    const frame = encodeRealtimeFrame('split me')
    expect(decode(frame.slice(0, 3))).toEqual([])
    expect(decode(frame.slice(3, 7))).toEqual([])
    expect(decode(frame.slice(7))).toEqual(['split me'])
  })

  it('handles a header split mid-length, the case naive decoders get wrong', () => {
    const decode = decodeRealtimeFrames()
    const frame = encodeRealtimeFrame('x')
    // Two bytes in: the kind byte plus one byte of the four-byte length.
    expect(decode(frame.slice(0, 2))).toEqual([])
    expect(decode(frame.slice(2))).toEqual(['x'])
  })

  it('delivers a complete message and buffers the partial one behind it', () => {
    const decode = decodeRealtimeFrames()
    const first = encodeRealtimeFrame('done')
    const second = encodeRealtimeFrame('pending')
    const chunk = new Uint8Array(first.byteLength + 4)
    chunk.set(first)
    chunk.set(second.slice(0, 4), first.byteLength)
    expect(decode(chunk)).toEqual(['done'])
    expect(decode(second.slice(4))).toEqual(['pending'])
  })

  it('decodes a message delivered one byte at a time', () => {
    const decode = decodeRealtimeFrames()
    const frame = encodeRealtimeFrame('drip')
    const seen: RealtimeMessage[] = []
    for (const byte of frame) seen.push(...decode(bytes(byte)))
    expect(seen).toEqual(['drip'])
  })

  it('refuses a length that exceeds the limit instead of allocating for it', () => {
    // A length prefix is the peer's claim, not a fact. Believing a four-gigabyte
    // one is how a desynchronized stream takes the tab down with it.
    const decode = decodeRealtimeFrames(8)
    const oversized = encodeRealtimeFrame('this is definitely longer than eight bytes')
    expect(() => decode(oversized)).toThrow(/exceeds the 8-byte limit/)
  })

  it('accepts a message exactly at the limit', () => {
    const decode = decodeRealtimeFrames(5)
    expect(decode(encodeRealtimeFrame('12345'))).toEqual(['12345'])
  })

  it('reads the length as big-endian, so the header is wire-compatible', () => {
    // Written out explicitly: a peer implementing this format in Go or Rust
    // reads these exact bytes, and a byte-order slip would only show up as a
    // wildly wrong length against a non-JavaScript server.
    const frame = encodeRealtimeFrame('hi')
    expect(Array.from(frame)).toEqual([1, 0, 0, 0, 2, 104, 105])
  })
})
