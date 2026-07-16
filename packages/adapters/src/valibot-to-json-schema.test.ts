import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import * as v from 'valibot'
import { describe, expect, it, vi } from 'vitest'

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

  it('emits 2020-12 prefixItems for tuples, not draft-07 array-items', async () => {
    // The converter defaults to draft-07 (`items: [...]`), which the generators
    // do not recognize as a tuple; the adapter must target 2020-12 so element
    // types and length are validated downstream.
    const result = await valibotToJsonSchema(v.object({ pair: v.tuple([v.string(), v.number()]) }))

    expect(result).toMatchObject({
      properties: {
        pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
      },
    })
    expect((result as { properties: { pair: Record<string, unknown> } }).properties.pair).not.toHaveProperty('items', [
      { type: 'string' },
      { type: 'number' },
    ])
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

  it('maps v.bigint() to an x-mjst primitive bigint hint', async () => {
    const result = await valibotToJsonSchema(v.object({ balance: v.bigint(), name: v.string() }))

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

  it('warns when a lossy construct is widened to an open schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await valibotToJsonSchema(v.object({ id: v.string(), sym: v.symbol() }))

      // The unrepresentable construct degraded to an open ("accept anything") schema.
      expect((result as { properties: { sym: Record<string, unknown> } }).properties.sym).toEqual({})
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[mjst\] Valibot adapter: symbol/))
    } finally {
      warn.mockRestore()
    }
  })

  it('batches multiple widened constructs into a single warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await valibotToJsonSchema(v.object({ a: v.symbol(), b: v.blob() }))

      expect(warn).toHaveBeenCalledTimes(1)
      // Distinct constructs are listed together, sorted, in one message.
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Valibot adapter: blob, symbol have no/))
    } finally {
      warn.mockRestore()
    }
  })

  it('reports a dropped refinement the converter cannot express', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // JSON Schema `pattern` has no place for RegExp flags, so the flagged regex
      // refinement is dropped and the schema is wider than the Valibot one.
      await valibotToJsonSchema(v.object({ code: v.pipe(v.string(), v.regex(/a/giu)) }))

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Valibot adapter: regex/))
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn for rescued date and bigint constructs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await valibotToJsonSchema(v.object({ when: v.date(), balance: v.bigint() }))
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('throws instead of widening in strict mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(valibotToJsonSchema(v.object({ sym: v.symbol() }), { strict: true })).rejects.toThrow(
        /Valibot adapter \(strict mode\): symbol/,
      )
      // Strict mode throws rather than logging.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn or throw in strict mode when nothing is lost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await valibotToJsonSchema(v.object({ name: v.string(), when: v.date() }), { strict: true })
      expect(result).toMatchObject({ properties: { name: { type: 'string' } } })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
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
