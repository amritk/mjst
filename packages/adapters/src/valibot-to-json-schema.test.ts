import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import { valibotToJsonSchema } from './valibot-to-json-schema'

describe('valibotToJsonSchema', () => {
  it('converts an object with required and optional fields', async () => {
    const schema = v.object({
      name: v.string(),
      age: v.optional(v.number()),
    })

    const result = await valibotToJsonSchema(schema)

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

  it('converts picklists to a string schema with an enum list', async () => {
    const result = await valibotToJsonSchema(v.object({ role: v.picklist(['admin', 'user']) }))

    expect(result).toMatchObject({
      properties: { role: { type: 'string', enum: ['admin', 'user'] } },
    })
  })

  it('converts arrays and nested objects', async () => {
    const schema = v.object({
      tags: v.array(v.string()),
      profile: v.object({ id: v.string() }),
    })

    const result = await valibotToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        profile: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    })
  })

  it('strips the $schema dialect marker', async () => {
    const result = await valibotToJsonSchema(v.object({ name: v.string() }))
    expect(result).not.toHaveProperty('$schema')
  })

  it('maps v.date() to an x-mjst instanceOf Date hint', async () => {
    const result = await valibotToJsonSchema(v.object({ when: v.date(), name: v.string() }))

    expect(result).toMatchObject({
      properties: {
        when: { 'x-mjst': { instanceOf: 'Date' } },
        name: { type: 'string' },
      },
    })
    expect((result as { properties: { when: Record<string, unknown> } }).properties.when).not.toHaveProperty('type')
  })

  it('throws a helpful error for non-object input', async () => {
    await expect(valibotToJsonSchema(null)).rejects.toThrow(/expected a Valibot schema but received null/)
    await expect(valibotToJsonSchema(42)).rejects.toThrow(/received number/)
  })

  it('round-trips through the type generator, including Date fields', async () => {
    const schema = v.object({
      id: v.string(),
      createdAt: v.date(),
      score: v.optional(v.number()),
    })

    const typeDef = generateTypeDefinition(await valibotToJsonSchema(schema), 'Event')

    expect(typeDef).toContain('id: string;')
    expect(typeDef).toContain('createdAt: Date;')
    expect(typeDef).toContain('score?: number;')
  })
})
