import { describe, expect, it } from 'vitest'

import { typeboxToJsonSchema } from './typebox-to-json-schema'

describe('typeboxToJsonSchema', () => {
  it('strips TypeBox symbol keys and returns plain JSON Schema', () => {
    // Mimic a TypeBox object schema: a plain JSON-Schema-shaped object that also
    // carries internal symbol keys. The symbols must not survive conversion.
    const Kind = Symbol.for('TypeBox.Kind')
    const typeboxSchema = {
      [Kind]: 'Object',
      type: 'object',
      properties: {
        name: { [Kind]: 'String', type: 'string' },
        age: { [Kind]: 'Number', type: 'number' },
      },
      required: ['name'],
    }

    const result = typeboxToJsonSchema(typeboxSchema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    })
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0)
  })

  it('preserves nested structures and arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        meta: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      },
    }

    expect(typeboxToJsonSchema(schema)).toEqual(schema)
  })

  it('rewrites TypeBox Date into an x-mjst instanceOf hint', () => {
    const schema = {
      type: 'object',
      properties: {
        createdAt: { type: 'Date' },
        name: { type: 'string' },
      },
      required: ['createdAt'],
    }

    expect(typeboxToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        createdAt: { 'x-mjst': { instanceOf: 'Date' } },
        name: { type: 'string' },
      },
      required: ['createdAt'],
    })
  })

  it('leaves unmapped extended types unchanged', () => {
    const schema = { type: 'object', properties: { buf: { type: 'Uint8Array' } } }
    expect(typeboxToJsonSchema(schema)).toEqual(schema)
  })

  it('throws a helpful error for non-object input', () => {
    expect(() => typeboxToJsonSchema(null)).toThrow(/expected a schema object but received null/)
    expect(() => typeboxToJsonSchema('nope')).toThrow(/received string/)
  })
})
