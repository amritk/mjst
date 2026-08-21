import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { BindableSocket } from './bind-messages'
import { bindMessages } from './bind-messages'
import type { MessageFailure } from './message-channel'
import { INVALID_MESSAGE_CLOSE_CODE, MAX_CLOSE_REASON_BYTES, truncateCloseReason } from './message-channel'
import { defineMessages } from './message-contracts'

const chat = defineMessages({
  clientToServer: {
    say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  serverToClient: {
    said: {
      type: 'object',
      properties: { from: { type: 'string' }, text: { type: 'string' } },
      required: ['from', 'text'],
    },
  },
})

/** One `close(code, reason)` call, with both arguments as they arrived. */
type CloseCall = [number | undefined, string | undefined]

/** A socket with no `addEventListener` — the Bun shape, fed through `accept`. */
const pushSocket = (): BindableSocket & { sent: string[]; closes: CloseCall[] } => {
  const sent: string[] = []
  const closes: CloseCall[] = []
  return { sent, closes, send: (data) => sent.push(data), close: (code, reason) => closes.push([code, reason]) }
}

/** An EventTarget-shaped socket — the Workers/Deno shape, wired automatically. */
const eventSocket = (): BindableSocket & {
  sent: string[]
  closes: CloseCall[]
  emit: (type: string, event: unknown) => void
} => {
  const listeners = new Map<string, ((event: never) => void)[]>()
  const base = pushSocket()
  return {
    ...base,
    addEventListener: (type, listener) => {
      const existing = listeners.get(type) ?? []
      existing.push(listener)
      listeners.set(type, existing)
    },
    emit: (type, event) => {
      for (const listener of listeners.get(type) ?? []) listener(event as never)
    },
  }
}

const next = async <T>(iterator: AsyncIterableIterator<T>): Promise<T | undefined> => (await iterator.next()).value

describe('bindMessages', () => {
  it('delivers a valid inbound message, narrowed', async () => {
    const socket = pushSocket()
    const channel = bindMessages(chat, socket)
    channel.accept(JSON.stringify({ type: 'say', text: 'hi' }))
    const message = await next(channel.messages)
    expect(message).toEqual({ type: 'say', text: 'hi' })
    if (message?.type === 'say') expectTypeOf(message.text).toEqualTypeOf<string>()
  })

  it('serializes an outbound message', () => {
    const socket = pushSocket()
    bindMessages(chat, socket).send({ type: 'said', from: 'ada', text: 'hi' })
    expect(socket.sent).toEqual([JSON.stringify({ type: 'said', from: 'ada', text: 'hi' })])
  })

  it('only accepts messages from the direction it validates', async () => {
    const socket = pushSocket()
    const channel = bindMessages(chat, socket)
    // `said` is serverToClient — a client sending it is not in the contract.
    channel.accept(JSON.stringify({ type: 'said', from: 'ada', text: 'hi' }))
    expect(socket.closes).toEqual([[INVALID_MESSAGE_CLOSE_CODE, 'unknown-type: said']])
  })

  it('closes 1007 on a frame that breaks the contract', () => {
    for (const [frame, expected] of [
      ['not json at all', 'malformed: not JSON'],
      [JSON.stringify([1, 2]), 'malformed: not a JSON object'],
      [JSON.stringify({ text: 'hi' }), "unknown-type: no 'type'"],
      [JSON.stringify({ type: 'nope' }), 'unknown-type: nope'],
    ] as const) {
      const socket = pushSocket()
      bindMessages(chat, socket).accept(frame)
      expect(socket.closes).toEqual([[INVALID_MESSAGE_CLOSE_CODE, expected]])
    }
  })

  it('reports the schema path on an invalid payload', () => {
    const socket = pushSocket()
    const failures: MessageFailure[] = []
    bindMessages(chat, socket, { onInvalid: (failure) => void failures.push(failure) }).accept(
      JSON.stringify({ type: 'say', text: 42 }),
    )
    expect(failures[0]?.reason).toBe('invalid-payload')
    expect(failures[0]?.name).toBe('say')
    expect(failures[0]?.errors?.[0]?.path).toBe('/text')
    // The hook returned nothing, so the default (close) still applies.
    expect(socket.closes[0]?.[0]).toBe(INVALID_MESSAGE_CLOSE_CODE)
  })

  it('lets onInvalid keep the connection open', async () => {
    const socket = pushSocket()
    const onInvalid = vi.fn(() => 'ignore' as const)
    const channel = bindMessages(chat, socket, { onInvalid })
    channel.accept(JSON.stringify({ type: 'say', text: 42 }))
    channel.accept(JSON.stringify({ type: 'say', text: 'hi' }))
    expect(onInvalid).toHaveBeenCalledOnce()
    expect(socket.closes).toEqual([])
    expect(await next(channel.messages)).toEqual({ type: 'say', text: 'hi' })
  })

  it('ignores a binary frame by default instead of closing', () => {
    const socket = pushSocket()
    const failures: MessageFailure[] = []
    bindMessages(chat, socket, { onInvalid: (failure) => void failures.push(failure) }).accept(
      new Uint8Array([1, 2, 3]),
    )
    // Surfaced, never silent — but binary is traffic the contract does not
    // describe rather than a contract violation, so the socket stays open.
    expect(failures[0]?.reason).toBe('binary')
    expect(socket.closes).toEqual([])
  })

  it('wires itself to an EventTarget-shaped socket', async () => {
    const socket = eventSocket()
    const channel = bindMessages(chat, socket)
    socket.emit('message', { data: JSON.stringify({ type: 'say', text: 'hi' }) })
    expect(await next(channel.messages)).toEqual({ type: 'say', text: 'hi' })
    socket.emit('close', {})
    expect(await channel.messages.next()).toEqual({ value: undefined, done: true })
  })

  it('accepts a valid frame under a composed, closed schema', () => {
    // The regression this guards: folding the discriminator into a copy of the
    // schema worked only for a plain object schema. A closed `allOf` branch
    // rejected the injected property, so a perfectly valid frame failed with
    // `must NOT have additional properties` and closed the socket with 1007.
    const composed = defineMessages({
      clientToServer: {
        say: {
          allOf: [
            {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          ],
        },
      },
    })
    const socket = pushSocket()
    const channel = bindMessages(composed, socket)
    channel.accept(JSON.stringify({ type: 'say', text: 'hi' }))
    expect(socket.closes).toEqual([])

    // Still enforced — the payload is checked, only the tag is exempt.
    channel.accept(JSON.stringify({ type: 'say', text: 'hi', extra: 1 }))
    expect(socket.closes[0]?.[0]).toBe(INVALID_MESSAGE_CLOSE_CODE)
  })

  it('does not read a message name off the prototype', () => {
    const socket = pushSocket()
    bindMessages(chat, socket).accept('{"__proto__":"say"}')
    expect(socket.closes).toEqual([[INVALID_MESSAGE_CLOSE_CODE, "unknown-type: no 'type'"]])
  })

  it('validates outbound only when asked, and throws rather than sending', () => {
    const loose = pushSocket()
    // Off by default: a wrong outbound message goes out as written.
    bindMessages(chat, loose).send({ type: 'said', from: 'ada' } as never)
    expect(loose.sent).toHaveLength(1)

    const strict = pushSocket()
    const channel = bindMessages(chat, strict, { validateOutbound: true })
    expect(() => channel.send({ type: 'said', from: 'ada' } as never)).toThrow(/failed its schema/)
    expect(() => channel.send({ type: 'nope' } as never)).toThrow(/not a serverToClient message/)
    expect(strict.sent).toEqual([])
  })

  it('truncates a close reason to the RFC 6455 budget, on a character boundary', () => {
    const long = truncateCloseReason('é'.repeat(200))
    expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(MAX_CLOSE_REASON_BYTES)
    // A split multi-byte character would make the reason invalid UTF-8, which
    // is the throw this avoids — so nothing is left half-decoded.
    expect(long).not.toContain('�')
  })

  it('closes and ends iteration together', async () => {
    const socket = pushSocket()
    const channel = bindMessages(chat, socket)
    channel.close(1000, 'bye')
    expect(socket.closes).toEqual([[1000, 'bye']])
    expect(await channel.messages.next()).toEqual({ value: undefined, done: true })
  })
})
