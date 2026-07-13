import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import { describe, expect, it, vi } from 'vitest'
// `zod-v3` is a dev-only alias for `zod@3` (see root package.json). Zod 3 has no
// native `toJSONSchema`, so the adapter must route it through the
// `zod-to-json-schema` fallback.
import { z } from 'zod-v3'

import { zodToJsonSchema } from './zod-to-json-schema'

// Force the adapter's `import('zod')` to resolve to a build with no
// `toJSONSchema`, so `loadToJsonSchema` returns null and the adapter falls back
// to `zod-to-json-schema`. The `zod-v3` and `zod-to-json-schema` specifiers are
// untouched, so the fallback runs against real Zod 3 schemas.
vi.mock('zod', () => ({ toJSONSchema: undefined, z: undefined, default: undefined }))

describe('zodToJsonSchema (Zod 3 fallback via zod-to-json-schema)', () => {
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

  it('maps z.date() to an x-mjst instanceOf Date hint', async () => {
    const result = await zodToJsonSchema(z.object({ when: z.date(), name: z.string() }))

    expect(result).toMatchObject({
      properties: {
        when: { 'x-mjst': { instanceOf: 'Date' } },
        name: { type: 'string' },
      },
    })
    // The date property must not carry a leftover JSON Schema `type`/`format`.
    const when = (result as { properties: { when: Record<string, unknown> } }).properties.when
    expect(when).not.toHaveProperty('type')
    expect(when).not.toHaveProperty('format')
  })

  it('maps z.bigint() to an x-mjst primitive bigint hint', async () => {
    const result = await zodToJsonSchema(z.object({ balance: z.bigint(), name: z.string() }))

    expect(result).toMatchObject({
      properties: {
        balance: { 'x-mjst': { primitive: 'bigint' } },
        name: { type: 'string' },
      },
    })
    const balance = (result as { properties: { balance: Record<string, unknown> } }).properties.balance
    expect(balance).not.toHaveProperty('type')
  })

  it('warns when a lossy (unrepresentable) Zod type is widened, keeping the field', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await zodToJsonSchema(z.object({ id: z.string(), sym: z.symbol() }))
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Zod adapter: symbol/))
      // The fallback would otherwise drop the symbol field entirely; the adapter
      // keeps it as an open schema, mirroring the Zod 4 widening.
      expect(result).toHaveProperty(['properties', 'sym'])
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

  it('normalises a fixed tuple to 2020-12 prefixItems with an exact length', async () => {
    const json = await zodToJsonSchema(z.tuple([z.string(), z.number()]))

    expect(json).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false,
    })
    // The draft-07 array-form `items` must not survive.
    expect(Array.isArray((json as { items?: unknown }).items)).toBe(false)
  })

  it('keeps a tuple rest element open but still requires the fixed prefix', async () => {
    const json = await zodToJsonSchema(z.tuple([z.string()]).rest(z.number()))

    expect(json).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'number' },
      minItems: 1,
    })
    expect((json as Record<string, unknown>).additionalItems).toBeUndefined()
  })

  it('throws a helpful error for non-object input', async () => {
    await expect(zodToJsonSchema(null)).rejects.toThrow(/expected a Zod schema but received null/)
    await expect(zodToJsonSchema('nope')).rejects.toThrow(/received string/)
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
