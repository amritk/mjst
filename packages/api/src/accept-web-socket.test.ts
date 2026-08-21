import { afterEach, describe, expect, it } from 'vitest'

import { acceptWebSocket } from './accept-web-socket'

type FakeSocket = { end: '0' | '1'; accepted: number }

/**
 * Stands in for workerd's `WebSocketPair`, which is an object keyed '0'
 * (client) and '1' (server) rather than an array — the shape the helper exists
 * to hide, and the one that is easy to get backwards.
 */
const installPair = (): (() => readonly FakeSocket[]) => {
  const made: FakeSocket[] = []
  const socket = (end: '0' | '1') => {
    const fake: FakeSocket = { end, accepted: 0 }
    made.push(fake)
    return {
      accept: () => {
        fake.accepted += 1
      },
      send: () => undefined,
      close: () => undefined,
      addEventListener: () => undefined,
      end,
    }
  }
  const pair = function WebSocketPair(): Record<string, unknown> {
    return { 0: socket('0'), 1: socket('1') }
  }
  Object.assign(globalThis, { WebSocketPair: pair })
  return () => made
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'WebSocketPair')
})

describe('accept-web-socket', () => {
  it('returns the server end, already accepted, alongside the reply', () => {
    const made = installPair()
    const { socket, reply } = acceptWebSocket()
    expect((socket as unknown as FakeSocket).end).toBe('1')
    expect(made().map((fake) => [fake.end, fake.accepted])).toEqual([
      ['0', 0],
      ['1', 1],
    ])
    expect(reply.raw).toBeInstanceOf(Response)
  })

  it('accepts only the server end, never the client end', () => {
    // Accepting the client end (or returning it to the handler) leaves both
    // sides waiting on each other — the failure this helper makes impossible.
    const made = installPair()
    acceptWebSocket()
    const client = made().find((fake) => fake.end === '0')
    expect(client?.accepted).toBe(0)
  })

  it('fails clearly when it is not running on workerd', () => {
    expect(() => acceptWebSocket()).toThrow(/requires the Workers runtime/)
  })
})
