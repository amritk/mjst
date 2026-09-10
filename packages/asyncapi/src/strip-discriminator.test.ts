import { describe, expect, it } from 'vitest'

import { stripDiscriminator } from './strip-discriminator'

describe('strip-discriminator', () => {
  it('drops a const declaration, its required entry, and reports the tag it pinned', () => {
    const payload = {
      type: 'object',
      properties: { type: { type: 'string', const: 'hello' }, text: { type: 'string' } },
      required: ['type', 'text'],
    }
    expect(stripDiscriminator(payload, 'type')).toEqual({
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      tag: 'hello',
    })
  })

  it('accepts a single-member enum as the same statement', () => {
    // The pre-`const` spelling, and what the Slack RTM documents actually use.
    const payload = { type: 'object', properties: { type: { type: 'string', enum: ['hello'] } } }
    expect(stripDiscriminator(payload, 'type')).toEqual({ schema: { type: 'object' }, tag: 'hello' })
  })

  it('drops properties and required entirely once they are empty', () => {
    const payload = { type: 'object', properties: { type: { const: 'goodbye' } }, required: ['type'] }
    expect(stripDiscriminator(payload, 'type').schema).toEqual({ type: 'object' })
  })

  it('strips only the discriminator, leaving every other keyword alone', () => {
    const payload = {
      type: 'object',
      additionalProperties: false,
      description: 'A chat line',
      properties: { kind: { const: 'say' }, text: { type: 'string' } },
      required: ['kind'],
    }
    expect(stripDiscriminator(payload, 'kind').schema).toEqual({
      type: 'object',
      additionalProperties: false,
      description: 'A chat line',
      properties: { text: { type: 'string' } },
    })
  })

  it('leaves a payload that never mentions the discriminator untouched', () => {
    // The common shape once components are rebased: a bare `$ref` into `$defs`.
    const payload = { $ref: '#/$defs/market', $defs: { market: { type: 'object' } } }
    expect(stripDiscriminator(payload, 'type')).toEqual({ schema: payload })
  })

  it('never mutates the payload it was given', () => {
    const payload = { type: 'object', properties: { type: { const: 'say' }, text: {} }, required: ['type'] }
    const before = structuredClone(payload)
    stripDiscriminator(payload, 'type')
    expect(payload).toEqual(before)
  })

  it('reports the tag verbatim even when it looks nothing like a message name', () => {
    // Slack's RTM API names a message `botAdded` and tags the frame
    // `bot_added`. The document is describing the bytes, so the bytes win.
    const payload = { type: 'object', properties: { type: { enum: ['bot_added'] } } }
    expect(stripDiscriminator(payload, 'type')).toEqual({ schema: { type: 'object' }, tag: 'bot_added' })
  })

  it('refuses a declaration that names no value at all', () => {
    const payload = { type: 'object', properties: { type: { type: 'string' } } }
    expect(stripDiscriminator(payload, 'type').issue).toMatch(/without pinning it to one value/)
  })

  it('refuses a multi-member enum, which does not identify one message', () => {
    const payload = { type: 'object', properties: { type: { enum: ['hello', 'goodbye'] } } }
    expect(stripDiscriminator(payload, 'type').issue).toMatch(/without pinning it to one value/)
  })

  it('refuses a tag pinned to a non-string, which no frame could ever route by', () => {
    // The runtime reads the tag off the frame and looks it up as a string key,
    // so `const: 7` names a message nothing can select.
    const payload = { type: 'object', properties: { type: { const: 7 } } }
    expect(stripDiscriminator(payload, 'type').issue).toMatch(/which is not a string/)
  })

  it('reads a const of the empty string as a real tag rather than an absent one', () => {
    // `const: ''` is falsy but declared, and dropping it would silently key the
    // message on its name instead of on the tag the document wrote.
    const payload = { type: 'object', properties: { type: { const: '' } } }
    expect(stripDiscriminator(payload, 'type')).toEqual({ schema: { type: 'object' }, tag: '' })
  })

  it('refuses a required entry with no matching property declaration', () => {
    // Nothing here says what the tag carries, and leaving the entry in place
    // would make every frame fail its own schema.
    const payload = { type: 'object', required: ['type'], properties: { text: {} } }
    expect(stripDiscriminator(payload, 'type').issue).toMatch(/requires "type" without declaring it/)
  })

  it('refuses a declaration that is not a schema', () => {
    const payload = { type: 'object', properties: { type: 'hello' } }
    expect(stripDiscriminator(payload, 'type').issue).toMatch(/not a schema/)
  })

  it('refuses a payload that is not an object schema', () => {
    expect(stripDiscriminator({ type: 'string', enum: ['\r\n'] }, 'type').issue).toMatch(/must be type 'object'/)
    // A union type fails for the same reason `assertMessageSchema` refuses it:
    // the runtime compares `type` against the string, not against a set.
    expect(stripDiscriminator({ type: ['object', 'null'] }, 'type').issue).toMatch(/must be type 'object'/)
  })

  it('refuses a payload that is not an object at all', () => {
    for (const payload of [true, null, [{ type: 'object' }], 'schema']) {
      expect(stripDiscriminator(payload, 'type').issue).toMatch(/not an object schema/)
    }
  })

  it('reads own properties only, so an inherited name is not a declaration', () => {
    // Payload property names come from the document, and `constructor` is one a
    // real message may use; a bare index would find `Object.prototype`'s.
    const payload = { type: 'object', properties: {} }
    expect(stripDiscriminator(payload, 'constructor')).toEqual({ schema: payload })
  })
})
