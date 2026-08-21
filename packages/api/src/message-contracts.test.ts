import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ClientToServerMessage, ServerToClientMessage } from './message-contracts'
import { composeMessageSchema, defineMessages, prepareMessages } from './message-contracts'

const chat = defineMessages({
  clientToServer: {
    say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    join: { type: 'object', properties: { room: { type: 'string' } }, required: ['room'] },
  },
  serverToClient: {
    said: {
      type: 'object',
      properties: { from: { type: 'string' }, text: { type: 'string' } },
      required: ['from', 'text'],
    },
  },
})

describe('defineMessages', () => {
  it('derives a tagged union per direction', () => {
    expectTypeOf<ClientToServerMessage<typeof chat>>().toEqualTypeOf<
      { readonly type: 'say'; text: string } | { readonly type: 'join'; room: string }
    >()
    expectTypeOf<ServerToClientMessage<typeof chat>>().toEqualTypeOf<{
      readonly type: 'said'
      from: string
      text: string
    }>()
  })

  it('honours a custom discriminator in the derived type', () => {
    const custom = defineMessages({
      discriminator: 'kind',
      clientToServer: { ping: { type: 'object', properties: {}, required: [] } },
    })
    expectTypeOf<ClientToServerMessage<typeof custom>>().toEqualTypeOf<{ readonly kind: 'ping' }>()
  })
})

describe('composeMessageSchema', () => {
  it('folds the discriminator into the schema as a const', () => {
    expect(composeMessageSchema({ type: 'object', properties: { text: { type: 'string' } } }, 'type', 'say')).toEqual({
      type: 'object',
      properties: { text: { type: 'string' }, type: { const: 'say' } },
      required: ['type'],
    })
  })

  it('keeps a closed schema closed, with room for the tag', () => {
    // The reason composition exists: validating the payload schema against the
    // whole frame would fail here on the very property naming the message.
    const composed = composeMessageSchema(
      { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      'type',
      'say',
    )
    expect(composed['additionalProperties']).toBe(false)
    expect(composed['required']).toEqual(['text', 'type'])
    expect((composed['properties'] as Record<string, unknown>)['type']).toEqual({ const: 'say' })
  })

  it('does not duplicate a discriminator the author already declared', () => {
    const composed = composeMessageSchema(
      { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
      'type',
      'say',
    )
    expect(composed['required']).toEqual(['type'])
    // Pinned to the message name, whatever the author wrote.
    expect((composed['properties'] as Record<string, unknown>)['type']).toEqual({ const: 'say' })
  })

  it('refuses a schema with nowhere to put the discriminator', () => {
    expect(() => composeMessageSchema({ type: 'string' }, 'type', 'say')).toThrow(/must be type 'object'/)
    expect(() => composeMessageSchema('nope', 'type', 'say')).toThrow(/must be an object schema/)
    expect(() => composeMessageSchema([], 'type', 'say')).toThrow(/must be an object schema/)
  })
})

describe('prepareMessages', () => {
  it('defaults the discriminator to type and prepares both directions', () => {
    const prepared = prepareMessages(chat)
    expect(prepared.discriminator).toBe('type')
    expect([...prepared.clientToServer.keys()].sort()).toEqual(['join', 'say'])
    expect([...prepared.serverToClient.keys()]).toEqual(['said'])
  })

  it('validates a whole frame, tag included', () => {
    const validator = prepareMessages(chat).clientToServer.get('say')
    expect(validator?.({ type: 'say', text: 'hi' })).toBe(true)
    // Right shape, wrong tag — not this message.
    expect(validator?.({ type: 'join', text: 'hi' })).not.toBe(true)
    expect(validator?.({ type: 'say' })).not.toBe(true)
  })

  it('memoizes per contract object', () => {
    expect(prepareMessages(chat)).toBe(prepareMessages(chat))
  })

  it('treats an absent direction as no messages, not an error', () => {
    const oneWay = defineMessages({ serverToClient: { tick: { type: 'object', properties: {} } } })
    expect(prepareMessages(oneWay).clientToServer.size).toBe(0)
    expect(prepareMessages(oneWay).serverToClient.size).toBe(1)
  })
})
