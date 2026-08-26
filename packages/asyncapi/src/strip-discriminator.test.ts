import { describe, expect, it } from 'vitest'

import { stripDiscriminator } from './strip-discriminator'

describe('strip-discriminator', () => {
  it('drops a const declaration that names the message, and its required entry', () => {
    const payload = {
      type: 'object',
      properties: { type: { type: 'string', const: 'hello' }, text: { type: 'string' } },
      required: ['type', 'text'],
    }
    expect(stripDiscriminator(payload, 'type', 'hello')).toEqual({
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    })
  })

  it('accepts a single-member enum as the same statement', () => {
    // The pre-`const` spelling, and what the Slack RTM documents actually use.
    const payload = { type: 'object', properties: { type: { type: 'string', enum: ['hello'] } } }
    expect(stripDiscriminator(payload, 'type', 'hello').schema).toEqual({ type: 'object' })
  })

  it('drops properties and required entirely once they are empty', () => {
    const payload = { type: 'object', properties: { type: { const: 'goodbye' } }, required: ['type'] }
    expect(stripDiscriminator(payload, 'type', 'goodbye').schema).toEqual({ type: 'object' })
  })

  it('strips only the discriminator, leaving every other keyword alone', () => {
    const payload = {
      type: 'object',
      additionalProperties: false,
      description: 'A chat line',
      properties: { kind: { const: 'say' }, text: { type: 'string' } },
      required: ['kind'],
    }
    expect(stripDiscriminator(payload, 'kind', 'say').schema).toEqual({
      type: 'object',
      additionalProperties: false,
      description: 'A chat line',
      properties: { text: { type: 'string' } },
    })
  })

  it('leaves a payload that never mentions the discriminator untouched', () => {
    // The common shape once components are rebased: a bare `$ref` into `$defs`.
    const payload = { $ref: '#/$defs/market', $defs: { market: { type: 'object' } } }
    expect(stripDiscriminator(payload, 'type', 'marketData')).toEqual({ schema: payload })
  })

  it('never mutates the payload it was given', () => {
    const payload = { type: 'object', properties: { type: { const: 'say' }, text: {} }, required: ['type'] }
    const before = structuredClone(payload)
    stripDiscriminator(payload, 'type', 'say')
    expect(payload).toEqual(before)
  })

  it('refuses a declaration pinned to a different value', () => {
    // Slack names two messages after one `bot_added` event; stripping the tag
    // would emit a contract listening for a frame that never arrives.
    const payload = { type: 'object', properties: { type: { enum: ['bot_added'] } } }
    expect(stripDiscriminator(payload, 'type', 'botChanged').issue).toMatch(/not pinned to this message's name/)
  })

  it('refuses a declaration that names no value at all', () => {
    const payload = { type: 'object', properties: { type: { type: 'string' } } }
    expect(stripDiscriminator(payload, 'type', 'hello').issue).toMatch(/not pinned to this message's name/)
  })

  it('refuses a multi-member enum, which does not identify one message', () => {
    const payload = { type: 'object', properties: { type: { enum: ['hello', 'goodbye'] } } }
    expect(stripDiscriminator(payload, 'type', 'hello').issue).toMatch(/not pinned to this message's name/)
  })

  it('refuses a required entry with no matching property declaration', () => {
    // Nothing here can confirm the value equals the message name, and leaving
    // it in place would make every frame fail its own schema.
    const payload = { type: 'object', required: ['type'], properties: { text: {} } }
    expect(stripDiscriminator(payload, 'type', 'say').issue).toMatch(/requires "type" without declaring it/)
  })

  it('refuses a declaration that is not a schema', () => {
    const payload = { type: 'object', properties: { type: 'hello' } }
    expect(stripDiscriminator(payload, 'type', 'hello').issue).toMatch(/not a schema/)
  })

  it('refuses a payload that is not an object schema', () => {
    expect(stripDiscriminator({ type: 'string', enum: ['\r\n'] }, 'type', 'ping').issue).toMatch(
      /must be type 'object'/,
    )
    // A union type fails for the same reason `assertMessageSchema` refuses it:
    // the runtime compares `type` against the string, not against a set.
    expect(stripDiscriminator({ type: ['object', 'null'] }, 'type', 'ping').issue).toMatch(/must be type 'object'/)
  })

  it('refuses a payload that is not an object at all', () => {
    for (const payload of [true, null, [{ type: 'object' }], 'schema']) {
      expect(stripDiscriminator(payload, 'type', 'ping').issue).toMatch(/not an object schema/)
    }
  })

  it('reads own properties only, so an inherited name is not a declaration', () => {
    // Payload property names come from the document, and `constructor` is one a
    // real message may use; a bare index would find `Object.prototype`'s.
    const payload = { type: 'object', properties: {} }
    expect(stripDiscriminator(payload, 'constructor', 'ping')).toEqual({ schema: payload })
  })
})
