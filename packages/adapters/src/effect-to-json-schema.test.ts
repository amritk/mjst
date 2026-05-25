import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { effectToJsonSchema } from './effect-to-json-schema'

describe('effectToJsonSchema', () => {
  it('converts a struct with required and optional fields', async () => {
    const schema = Schema.Struct({
      name: Schema.String,
      age: Schema.optional(Schema.Number),
    })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    })
    expect((result as { required: string[] }).required).not.toContain('age')
  })

  it('strips the $schema dialect marker', async () => {
    const result = await effectToJsonSchema(Schema.Struct({ name: Schema.String }))
    expect(result).not.toHaveProperty('$schema')
  })

  it('converts arrays and nested structs', async () => {
    const schema = Schema.Struct({
      tags: Schema.Array(Schema.String),
      profile: Schema.Struct({ id: Schema.String }),
    })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        profile: { type: 'object', properties: { id: { type: 'string' } } },
      },
    })
  })

  it('represents Schema.Date as its encoded string form', async () => {
    // Effect models Schema.Date as a string-to-Date decode, so the JSON Schema
    // (the wire representation) is a string referenced via $defs.
    const result = await effectToJsonSchema(Schema.Struct({ when: Schema.Date }))

    const json = JSON.stringify(result)
    expect(json).toContain('"when"')
    expect(json).toContain('string')
  })

  it('throws a helpful error for non-object input', async () => {
    await expect(effectToJsonSchema(null)).rejects.toThrow(/expected an Effect Schema but received null/)
    await expect(effectToJsonSchema('nope')).rejects.toThrow(/received string/)
  })

  it('round-trips a plain struct through the type generator', async () => {
    const schema = Schema.Struct({
      id: Schema.String,
      score: Schema.optional(Schema.Number),
    })

    const typeDef = generateTypeDefinition(await effectToJsonSchema(schema), 'Event')

    expect(typeDef).toContain('id: string;')
    expect(typeDef).toContain('score?: number;')
  })
})
