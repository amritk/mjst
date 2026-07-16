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

  it('emits 2020-12 prefixItems for a fixed tuple, not draft-07 array-items', async () => {
    // Effect's JSONSchema.make emits draft-07 tuples (`items: [...]`), which the
    // generators do not recognize as a tuple; the adapter must normalize to
    // `prefixItems` + a length bound so element types and length are validated.
    const result = await effectToJsonSchema(Schema.Struct({ pair: Schema.Tuple(Schema.String, Schema.Number) }))

    const pair = (result as { properties: { pair: Record<string, unknown> } }).properties.pair
    expect(pair).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false,
    })
    // The draft-07 array-form `items` must be gone.
    expect(Array.isArray(pair['items'])).toBe(false)
  })

  it('keeps a variadic Schema.Array as a plain array, not a tuple', async () => {
    const result = await effectToJsonSchema(Schema.Struct({ xs: Schema.Array(Schema.Number) }))
    expect(result).toMatchObject({ properties: { xs: { type: 'array', items: { type: 'number' } } } })
    expect((result as { properties: { xs: Record<string, unknown> } }).properties.xs).not.toHaveProperty('prefixItems')
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

  it('rescues a top-level BigIntFromSelf into an x-mjst bigint hint', async () => {
    expect(await effectToJsonSchema(Schema.BigIntFromSelf)).toEqual({ 'x-mjst': { primitive: 'bigint' } })
  })

  it('rescues a top-level DateFromSelf into an x-mjst Date hint', async () => {
    expect(await effectToJsonSchema(Schema.DateFromSelf)).toEqual({ 'x-mjst': { instanceOf: 'Date' } })
  })

  it('rescues a nested BigIntFromSelf inside a struct', async () => {
    const schema = Schema.Struct({ a: Schema.BigIntFromSelf, b: Schema.String })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        a: { 'x-mjst': { primitive: 'bigint' } },
        b: { type: 'string' },
      },
      required: ['a', 'b'],
    })
  })

  it('rescues a nested DateFromSelf inside a struct', async () => {
    const schema = Schema.Struct({ when: Schema.DateFromSelf, label: Schema.String })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        when: { 'x-mjst': { instanceOf: 'Date' } },
        label: { type: 'string' },
      },
    })
  })

  it('rescues a BigIntFromSelf nested in an array', async () => {
    const schema = Schema.Struct({ ids: Schema.Array(Schema.BigIntFromSelf) })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        ids: { type: 'array', items: { 'x-mjst': { primitive: 'bigint' } } },
      },
    })
  })

  it('rescues a DateFromSelf nested in a union', async () => {
    const schema = Schema.Struct({ value: Schema.Union(Schema.String, Schema.DateFromSelf) })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        value: { anyOf: [{ type: 'string' }, { 'x-mjst': { instanceOf: 'Date' } }] },
      },
    })
  })

  it('rescues a deeply nested unrepresentable type', async () => {
    const schema = Schema.Struct({ outer: Schema.Struct({ inner: Schema.DateFromSelf }) })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        outer: {
          type: 'object',
          properties: { inner: { 'x-mjst': { instanceOf: 'Date' } } },
        },
      },
    })
  })

  it('keeps Schema.Date as an encoded string alongside a rescued sibling', async () => {
    // Schema.Date decodes from a string, so it stays a string schema (referenced
    // via the hoisted $defs) even when a sibling field forces the recursive walk.
    const schema = Schema.Struct({ when: Schema.Date, big: Schema.BigIntFromSelf })

    const result = await effectToJsonSchema(schema)

    expect(result).toMatchObject({
      properties: {
        big: { 'x-mjst': { primitive: 'bigint' } },
      },
      $defs: { Date: { type: 'string' } },
    })
    expect(JSON.stringify(result)).toContain('#/$defs/Date')
  })

  it('throws an actionable error for a genuinely unrepresentable nested type', async () => {
    const schema = Schema.Struct({ sym: Schema.SymbolFromSelf, ok: Schema.String })
    await expect(effectToJsonSchema(schema)).rejects.toThrow(/no JSON Schema representation/)
  })
})
