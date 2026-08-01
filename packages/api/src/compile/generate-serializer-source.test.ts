import { describe, expect, it } from 'vitest'

import { generateSerializerSource } from './generate-serializer-source'

describe('generate-serializer-source', () => {
  it('emits positional concatenation with required keys first', () => {
    const source = generateSerializerSource({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    })
    expect(source).toContain('"{\\"id\\":"')
    expect(source).toContain('JSON.stringify(body["name"])')
    // Optional property appended only when present.
    expect(source).toContain('if (body["email"] !== undefined) out +=')
  })

  it('protects numbers against NaN and Infinity', () => {
    const source = generateSerializerSource({
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
      additionalProperties: false,
    })
    expect(source).toContain('Number.isFinite(body["n"])')
  })

  it('bails without additionalProperties: false — open schemas may carry unknown keys', () => {
    expect(
      generateSerializerSource({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }),
    ).toBeUndefined()
  })

  it('bails on non-primitive properties, empty required, and constraint keywords', () => {
    expect(
      generateSerializerSource({
        type: 'object',
        properties: { list: { type: 'array' } },
        required: ['list'],
        additionalProperties: false,
      }),
    ).toBeUndefined()
    expect(
      generateSerializerSource({ type: 'object', properties: { n: { type: 'number' } }, additionalProperties: false }),
    ).toBeUndefined()
    expect(
      generateSerializerSource({
        type: 'object',
        properties: { n: { type: 'number', minimum: 1 } },
        required: ['n'],
        additionalProperties: false,
      }),
    ).toBeUndefined()
  })

  // The emitted reader is `body["<key>"]`, which answers with the inherited
  // member rather than `undefined` when a prototype-shadowing property is
  // absent: a `__proto__` property would serialize as `Object.prototype`
  // (`{}`) and an optional `toString` would be emitted on every reply. Neither
  // matches `JSON.stringify`, which is what the runtime engine sends, so these
  // fall back to it — the same bail the inline guard emitter makes.
  it('bails on a property whose name shadows an Object.prototype member', () => {
    expect(
      generateSerializerSource(
        JSON.parse(
          '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"additionalProperties":false}',
        ),
      ),
    ).toBeUndefined()
    expect(
      generateSerializerSource({
        type: 'object',
        properties: { ok: { type: 'boolean' }, toString: { type: 'string' } },
        required: ['ok'],
        additionalProperties: false,
      }),
    ).toBeUndefined()
  })
})
