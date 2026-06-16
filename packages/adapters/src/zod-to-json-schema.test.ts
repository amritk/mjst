import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import { describe, expect, it, vi } from 'vitest'
import * as zodModule from 'zod'

import { zodToJsonSchema } from './zod-to-json-schema'

// Resolve the `z` namespace regardless of how the installed Zod build exports it.
const z = ((zodModule as Record<string, unknown>)['z'] ??
  (zodModule as Record<string, unknown>)['default'] ??
  zodModule) as typeof import('zod')['z']

describe('zodToJsonSchema', () => {
  it('converts a flat object with required and optional fields', async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().optional(),
      score: z.number().optional(),
    })

    const result = await zodToJsonSchema(schema)

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        score: { type: 'number' },
      },
      required: ['name'],
    })
    expect((result as { required: string[] }).required).not.toContain('age')
    expect((result as { required: string[] }).required).not.toContain('score')
  })

  it('strips the $schema dialect marker', async () => {
    const result = await zodToJsonSchema(z.object({ name: z.string() }))
    expect(result).not.toHaveProperty('$schema')
  })

  it('warns when a lossy (unrepresentable) Zod type is widened to "accept anything"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await zodToJsonSchema(z.object({ id: z.string(), sym: z.symbol() }))
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Zod adapter: symbol/))
    } finally {
      warn.mockRestore()
    }
  })

  it('converts enums to a string schema with an enum list', async () => {
    const result = await zodToJsonSchema(z.object({ role: z.enum(['admin', 'user']) }))

    expect(result).toMatchObject({
      properties: { role: { type: 'string', enum: ['admin', 'user'] } },
    })
  })

  it('converts arrays and nested objects', async () => {
    const schema = z.object({
      tags: z.array(z.string()),
      profile: z.object({ id: z.string() }),
    })

    const result = await zodToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        profile: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    })
  })

  it('converts a top-level scalar schema', async () => {
    expect(await zodToJsonSchema(z.string())).toMatchObject({ type: 'string' })
  })

  it('maps z.date() to an x-mjst instanceOf Date hint', async () => {
    const result = await zodToJsonSchema(z.object({ when: z.date(), name: z.string() }))

    expect(result).toMatchObject({
      properties: {
        when: { 'x-mjst': { instanceOf: 'Date' } },
        name: { type: 'string' },
      },
    })
    // The date property must not carry a leftover JSON Schema `type`.
    expect((result as { properties: { when: Record<string, unknown> } }).properties.when).not.toHaveProperty('type')
  })

  it('maps z.bigint() to an x-mjst primitive bigint hint', async () => {
    const result = await zodToJsonSchema(z.object({ balance: z.bigint(), name: z.string() }))

    expect(result).toMatchObject({
      properties: {
        balance: { 'x-mjst': { primitive: 'bigint' } },
        name: { type: 'string' },
      },
    })
    expect((result as { properties: { balance: Record<string, unknown> } }).properties.balance).not.toHaveProperty(
      'type',
    )
  })

  it('throws a helpful error for non-object input', async () => {
    await expect(zodToJsonSchema(null)).rejects.toThrow(/expected a Zod schema but received null/)
    await expect(zodToJsonSchema('nope')).rejects.toThrow(/received string/)
  })

  it('enforces the length of a fixed tuple', async () => {
    // Zod emits a bare `prefixItems` with no length bound; the adapter restores
    // the exact-length constraint a Zod tuple actually has.
    const json = await zodToJsonSchema(z.tuple([z.string(), z.number()]))

    expect(json).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false,
    })
  })

  it('keeps a tuple rest element open but still requires the fixed prefix', async () => {
    const json = await zodToJsonSchema(z.tuple([z.string()]).rest(z.number()))

    expect(json).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'number' },
      minItems: 1,
    })
    expect('maxItems' in (json as object)).toBe(false)
  })

  it('merges an object intersection into one satisfiable closed object', async () => {
    // Zod emits the intersection as an `allOf` of two `additionalProperties:false`
    // objects, which rejects every value; the adapter merges them.
    const json = await zodToJsonSchema(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })))

    expect(json).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    })
  })

  it('leaves a non-object intersection as an allOf', async () => {
    const json = await zodToJsonSchema(z.intersection(z.string().min(2), z.string().max(5)))
    expect(json).toMatchObject({ allOf: [{ type: 'string', minLength: 2 }, { type: 'string', maxLength: 5 }] })
  })

  it('round-trips through the type generator, including Date fields', async () => {
    const schema = z.object({
      id: z.string(),
      createdAt: z.date(),
      score: z.number().optional(),
    })

    const json = await zodToJsonSchema(schema)
    const typeDef = generateTypeDefinition(json, 'Event')

    expect(typeDef).toContain('id: string;')
    expect(typeDef).toContain('createdAt: Date;')
    expect(typeDef).toContain('score?: number;')
  })
})
