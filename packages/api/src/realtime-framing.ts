/**
 * One message on a realtime connection. Text and binary stay distinct all the
 * way across, because `WebSocket` distinguishes them natively and a channel
 * that silently turned strings into bytes would break every peer that checks
 * `typeof event.data`.
 */
export type RealtimeMessage = string | Uint8Array

/** Header byte marking a frame's payload as UTF-8 text. */
const TEXT = 1
/** Header byte marking a frame's payload as opaque bytes. */
const BINARY = 0

/** Kind byte plus a 32-bit big-endian payload length. */
const HEADER_BYTES = 5

/**
 * The default ceiling on a single frame, in bytes.
 *
 * A length prefix is a promise from the peer, and a desynchronized or hostile
 * one can promise four gigabytes. Refusing early turns that into a closed
 * connection rather than an allocation that takes the tab down with it.
 */
export const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

/**
 * Frames one message for a WebTransport bidirectional stream.
 *
 * WebTransport streams are byte streams with no message boundaries — unlike
 * `WebSocket`, which frames for you — so anything that wants discrete messages
 * has to supply its own framing. This is the plainest one that works: a kind
 * byte, a 32-bit big-endian length, then the payload.
 *
 * The wire format is written down here rather than hidden because the peer has
 * to match it, and that peer is not built from this package: no runtime this
 * library targets can serve WebTransport, so the server on the other end is a
 * quic-go, wtransport, or `@fails-components/webtransport` process. Ten lines
 * there reproduce this exactly. {@link decodeRealtimeFrames} is the inverse
 * and the two must change together.
 */
export const encodeRealtimeFrame = (message: RealtimeMessage): Uint8Array => {
  const payload = typeof message === 'string' ? new TextEncoder().encode(message) : message
  const frame = new Uint8Array(HEADER_BYTES + payload.byteLength)
  frame[0] = typeof message === 'string' ? TEXT : BINARY
  new DataView(frame.buffer).setUint32(1, payload.byteLength, false)
  frame.set(payload, HEADER_BYTES)
  return frame
}

/**
 * Builds a stateful decoder for the format {@link encodeRealtimeFrame} writes.
 *
 * A stream hands over arbitrary chunks: half a header, three whole messages,
 * then the first byte of a fourth. The decoder buffers what it cannot yet use
 * and returns only the messages that completed with this chunk, so a caller
 * can feed it straight from a reader loop.
 *
 * Throws on a length that exceeds `maxMessageBytes` — see
 * {@link DEFAULT_MAX_MESSAGE_BYTES} for why that is a refusal and not a
 * resize.
 */
export const decodeRealtimeFrames = (
  maxMessageBytes: number = DEFAULT_MAX_MESSAGE_BYTES,
): ((chunk: Uint8Array) => readonly RealtimeMessage[]) => {
  const decoder = new TextDecoder()
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

  return (chunk: Uint8Array): readonly RealtimeMessage[] => {
    // Concatenating per chunk is not the fastest possible decoder, but a
    // realtime channel is latency-bound rather than throughput-bound, and the
    // alternative (a chunk list plus cross-chunk index arithmetic) is the kind
    // of code that goes subtly wrong on a split header.
    if (buffered.byteLength === 0) {
      buffered = chunk
    } else {
      const joined = new Uint8Array(buffered.byteLength + chunk.byteLength)
      joined.set(buffered)
      joined.set(chunk, buffered.byteLength)
      buffered = joined
    }

    const messages: RealtimeMessage[] = []
    let offset = 0
    while (buffered.byteLength - offset >= HEADER_BYTES) {
      const view = new DataView(buffered.buffer, buffered.byteOffset + offset, HEADER_BYTES)
      const length = view.getUint32(1, false)
      if (length > maxMessageBytes) {
        throw new Error(`Realtime frame of ${length} bytes exceeds the ${maxMessageBytes}-byte limit`)
      }
      if (buffered.byteLength - offset - HEADER_BYTES < length) break

      const start = offset + HEADER_BYTES
      const payload = buffered.slice(start, start + length)
      messages.push(buffered[offset] === TEXT ? decoder.decode(payload) : payload)
      offset = start + length
    }

    buffered = offset === 0 ? buffered : buffered.slice(offset)
    return messages
  }
}
