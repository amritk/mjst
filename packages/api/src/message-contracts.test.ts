import { describe, expect, expectTypeOf, it } from 'vitest'

import { defineRoute } from './define-route'
import type { ClientToServerMessage, ServerToClientMessage } from './message-contracts'
import { assertMessageSchema, defineMessages, prepareMessages } from './message-contracts'

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

describe('route-attached messages', () => {
  it('keeps the contract types through defineRoute', () => {
    // `messages` has to be a generic slot on the route contract, not an erased
    // `AnyMessagesContract`: erased, it does not narrow, and
    // `send({ type: 'anything' })` type-checks and fails only at runtime.
    const route = defineRoute({
      method: 'get',
      path: '/ws',
      messages: chat,
      responses: { 426: {} },
      handler: () => ({ status: 426 as const }),
    })
    expectTypeOf<NonNullable<(typeof route)['messages']>>().toEqualTypeOf<typeof chat>()
  })

  it('gives an undeclared direction no shape at all', () => {
    const oneWay = defineMessages({ serverToClient: { tick: { type: 'object', properties: {} } } })
    // `never`, not `{ type: string }` — nothing may be sent up a contract that
    // declares no clientToServer messages.
    expectTypeOf<ClientToServerMessage<typeof oneWay>>().toEqualTypeOf<never>()
  })
})

describe('assertMessageSchema', () => {
  it('accepts a plain object schema', () => {
    expect(() =>
      assertMessageSchema({ type: 'object', properties: { text: { type: 'string' } } }, 'type', 'say'),
    ).not.toThrow()
  })

  it('accepts a composed schema, which is the whole point of not folding the tag in', () => {
    expect(() =>
      assertMessageSchema({ allOf: [{ $ref: '#/$defs/Say' }], unevaluatedProperties: false }, 'type', 'say'),
    ).not.toThrow()
  })

  it('refuses a schema with nowhere to put a payload', () => {
    expect(() => assertMessageSchema({ type: 'string' }, 'type', 'say')).toThrow(/must be type 'object'/)
    expect(() => assertMessageSchema('nope', 'type', 'say')).toThrow(/must be an object schema/)
    expect(() => assertMessageSchema([], 'type', 'say')).toThrow(/must be an object schema/)
  })

  it('refuses a schema that declares the discriminator itself', () => {
    // Unsatisfiable now: the property is removed before the validator runs, so
    // a schema describing it could only ever fail.
    expect(() =>
      assertMessageSchema({ type: 'object', properties: { type: { type: 'string' } } }, 'type', 'say'),
    ).toThrow(/must not declare 'type'/)
    expect(() => assertMessageSchema({ type: 'object', required: ['type'] }, 'type', 'say')).toThrow(
      /must not declare 'type'/,
    )
    // Under a custom discriminator it is the custom name that is reserved, and
    // a property called `type` becomes ordinary payload again.
    expect(() => assertMessageSchema({ type: 'object', required: ['type'] }, 'kind', 'say')).not.toThrow()
  })
})

describe('prepareMessages', () => {
  it('defaults the discriminator to type and prepares both directions', () => {
    const prepared = prepareMessages(chat)
    expect(prepared.discriminator).toBe('type')
    expect([...prepared.clientToServer.keys()].sort()).toEqual(['join', 'say'])
    expect([...prepared.serverToClient.keys()]).toEqual(['said'])
  })

  it('validates the payload, which the tag is no longer part of', () => {
    const validator = prepareMessages(chat).clientToServer.get('say')
    // The frame's tag is stripped before this runs, so the payload is what
    // reaches the validator.
    expect(validator?.({ text: 'hi' })).toBe(true)
    expect(validator?.({})).not.toBe(true)
  })

  it('refuses a message schema declaring the discriminator, at prepare time', () => {
    const bad = defineMessages({
      clientToServer: { say: { type: 'object', properties: { type: { type: 'string' } } } },
    })
    expect(() => prepareMessages(bad)).toThrow(/must not declare 'type'/)
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
