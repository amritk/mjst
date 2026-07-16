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
})
