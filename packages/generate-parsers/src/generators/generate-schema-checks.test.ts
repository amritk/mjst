import { describe, expect, it } from 'vitest'

import { generateSchemaChecks } from './generate-schema-checks'

describe('generate-schema-checks', () => {
  it('returns empty checks for a schema without type and no inferrable keywords', () => {
    const result = generateSchemaChecks('value', { description: 'no type' })
    expect(result).toEqual([])
  })

  it.todo('infers object type from properties keyword', () => {
    const result = generateSchemaChecks('value', {
      properties: { id: { type: 'string' } },
    })
    expect(result).toEqual(['typeof value === "object" && value !== null && !Array.isArray(value)'])
  })

  it.todo('infers object type from required keyword', () => {
    const result = generateSchemaChecks('value', {
      required: ['id', 'name'],
    })
    expect(result).toEqual([
      'typeof value === "object" && value !== null && !Array.isArray(value)',
      '"id" in value',
      '"name" in value',
    ])
  })

  it.todo('infers array type from items keyword', () => {
    const result = generateSchemaChecks('value', {
      items: { type: 'string' },
    })
    expect(result).toEqual(['Array.isArray(value)'])
  })

  it.todo('infers array type from minItems/maxItems keywords', () => {
    const result = generateSchemaChecks('value', {
      minItems: 1,
      maxItems: 10,
    })
    expect(result).toEqual(['Array.isArray(value)', 'value.length >= 1', 'value.length <= 10'])
  })

  it.todo('infers string type from minLength keyword', () => {
    const result = generateSchemaChecks('value', {
      minLength: 1,
    })
    expect(result).toEqual(['typeof value === "string"', 'value.length >= 1'])
  })

  it.todo('infers string type from pattern keyword', () => {
    const result = generateSchemaChecks('value', {
      pattern: '^[a-z]+$',
    })
    expect(result).toEqual(['typeof value === "string"', '/^[a-z]+$/.test(value)'])
  })

  it.todo('infers number type from minimum keyword', () => {
    const result = generateSchemaChecks('value', {
      minimum: 0,
    })
    expect(result).toEqual(['typeof value === "number"', 'value >= 0'])
  })

  it.todo('infers number type from multipleOf keyword', () => {
    const result = generateSchemaChecks('value', {
      multipleOf: 5,
    })
    expect(result).toEqual(['typeof value === "number"', 'value % 5 === 0'])
  })

  it.todo('infers boolean type from const boolean value', () => {
    const result = generateSchemaChecks('value', {
      const: true,
    })
    expect(result).toEqual(['typeof value === "boolean"'])
  })

  it.todo('infers null type from const null value', () => {
    const result = generateSchemaChecks('value', {
      const: null,
    })
    expect(result).toEqual(['value === null'])
  })

  it.todo('infers null type from all-null enum', () => {
    const result = generateSchemaChecks('value', {
      enum: [null, null],
    })
    expect(result).toEqual(['[null,null].includes(value as never)'])
  })

  // When object and array keywords tie, object wins (matches inferSchemaType priority)
  it.todo('prefers object over array when keyword scores tie', () => {
    const result = generateSchemaChecks('value', {
      minProperties: 1,
      minItems: 1,
    })
    expect(result).toContain('typeof value === "object" && value !== null && !Array.isArray(value)')
    expect(result).not.toContain('Array.isArray(value)')
  })

  // Array keywords outnumber string keywords so array wins
  it.todo('selects highest scoring type when multiple keyword categories present', () => {
    const result = generateSchemaChecks('value', {
      minItems: 1,
      maxItems: 3,
      minLength: 2,
    })
    expect(result).toContain('Array.isArray(value)')
    expect(result).not.toContain('typeof value === "string"')
  })

  it.todo('applies inferred type constraints alongside explicit enum check', () => {
    const result = generateSchemaChecks('value', {
      minimum: 0,
      maximum: 10,
      enum: [0, 5, 10],
    })
    expect(result).toContain('typeof value === "number"')
    expect(result).toContain('value >= 0')
    expect(result).toContain('value <= 10')
    expect(result).toContain('[0,5,10].includes(value as never)')
  })

  it('returns empty checks for a boolean schema', () => {
    const result = generateSchemaChecks('value', true)
    expect(result).toEqual([])
  })

  it('generates typeof check for string type', () => {
    const result = generateSchemaChecks('value', { type: 'string' })
    expect(result).toEqual(['typeof value === "string"'])
  })

  it('generates string check with pattern', () => {
    const result = generateSchemaChecks('value', { type: 'string', pattern: '^[a-z]+$' })
    expect(result).toEqual(['typeof value === "string"', '/^[a-z]+$/.test(value)'])
  })

  it('generates string check with minLength', () => {
    const result = generateSchemaChecks('value', { type: 'string', minLength: 1 })
    expect(result).toEqual(['typeof value === "string"', 'value.length >= 1'])
  })

  it('generates string check with maxLength', () => {
    const result = generateSchemaChecks('value', { type: 'string', maxLength: 100 })
    expect(result).toEqual(['typeof value === "string"', 'value.length <= 100'])
  })

  it('generates string check with both min and max length', () => {
    const result = generateSchemaChecks('value', { type: 'string', minLength: 1, maxLength: 50 })
    expect(result).toEqual(['typeof value === "string"', 'value.length >= 1', 'value.length <= 50'])
  })

  it('generates typeof check for number type', () => {
    const result = generateSchemaChecks('value', { type: 'number' })
    expect(result).toEqual(['typeof value === "number"'])
  })

  it('generates number check with minimum', () => {
    const result = generateSchemaChecks('value', { type: 'number', minimum: 0 })
    expect(result).toEqual(['typeof value === "number"', 'value >= 0'])
  })

  it('generates number check with maximum', () => {
    const result = generateSchemaChecks('value', { type: 'number', maximum: 100 })
    expect(result).toEqual(['typeof value === "number"', 'value <= 100'])
  })

  it('generates number check with exclusiveMinimum', () => {
    const result = generateSchemaChecks('value', { type: 'number', exclusiveMinimum: 0 })
    expect(result).toEqual(['typeof value === "number"', 'value > 0'])
  })

  it('generates number check with exclusiveMaximum', () => {
    const result = generateSchemaChecks('value', { type: 'number', exclusiveMaximum: 100 })
    expect(result).toEqual(['typeof value === "number"', 'value < 100'])
  })

  it('generates number check with multipleOf', () => {
    const result = generateSchemaChecks('value', { type: 'number', multipleOf: 5 })
    expect(result).toEqual(['typeof value === "number"', 'value % 5 === 0'])
  })

  it('generates typeof check for integer type', () => {
    const result = generateSchemaChecks('value', { type: 'integer' })
    expect(result).toEqual(['typeof value === "number"'])
  })

  it('generates integer check with all numeric constraints', () => {
    const result = generateSchemaChecks('value', {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      exclusiveMinimum: 0,
      exclusiveMaximum: 11,
      multipleOf: 2,
    })
    expect(result).toEqual([
      'typeof value === "number"',
      'value >= 1',
      'value <= 10',
      'value > 0',
      'value < 11',
      'value % 2 === 0',
    ])
  })

  it('generates typeof check for boolean type', () => {
    const result = generateSchemaChecks('value', { type: 'boolean' })
    expect(result).toEqual(['typeof value === "boolean"'])
  })

  it('generates Array.isArray check for array type', () => {
    const result = generateSchemaChecks('value', { type: 'array' })
    expect(result).toEqual(['Array.isArray(value)'])
  })

  it('generates array check with minItems', () => {
    const result = generateSchemaChecks('value', { type: 'array', minItems: 1 })
    expect(result).toEqual(['Array.isArray(value)', 'value.length >= 1'])
  })

  it('generates array check with maxItems', () => {
    const result = generateSchemaChecks('value', { type: 'array', maxItems: 10 })
    expect(result).toEqual(['Array.isArray(value)', 'value.length <= 10'])
  })

  it('generates array check with uniqueItems true', () => {
    const result = generateSchemaChecks('value', { type: 'array', uniqueItems: true })
    expect(result).toEqual(['Array.isArray(value)', 'new Set(value).size === value.length'])
  })

  it('does not add uniqueItems check when uniqueItems is false', () => {
    const result = generateSchemaChecks('value', { type: 'array', uniqueItems: false })
    expect(result).toEqual(['Array.isArray(value)'])
  })

  it('generates object type check', () => {
    const result = generateSchemaChecks('value', { type: 'object' })
    expect(result).toEqual(['typeof value === "object" && value !== null && !Array.isArray(value)'])
  })

  it('generates object check with required properties', () => {
    const result = generateSchemaChecks('value', {
      type: 'object',
      required: ['name', 'age'],
    })
    expect(result).toEqual([
      'typeof value === "object" && value !== null && !Array.isArray(value)',
      '"name" in value',
      '"age" in value',
    ])
  })

  it('generates object check with minProperties', () => {
    const result = generateSchemaChecks('value', { type: 'object', minProperties: 1 })
    expect(result).toEqual([
      'typeof value === "object" && value !== null && !Array.isArray(value)',
      'Object.keys(value).length >= 1',
    ])
  })

  it('generates object check with maxProperties', () => {
    const result = generateSchemaChecks('value', { type: 'object', maxProperties: 5 })
    expect(result).toEqual([
      'typeof value === "object" && value !== null && !Array.isArray(value)',
      'Object.keys(value).length <= 5',
    ])
  })

  it('generates object check with additionalProperties false', () => {
    const result = generateSchemaChecks('value', {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    })
    expect(result).toEqual([
      'typeof value === "object" && value !== null && !Array.isArray(value)',
      'Object.keys(value).every(k => ["name"].includes(k))',
    ])
  })

  it('does not add additionalProperties check when additionalProperties is true', () => {
    const result = generateSchemaChecks('value', {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: true,
    })
    expect(result).toEqual(['typeof value === "object" && value !== null && !Array.isArray(value)'])
  })

  it('does not add additionalProperties check when no properties defined', () => {
    const result = generateSchemaChecks('value', {
      type: 'object',
      additionalProperties: false,
    })
    expect(result).toEqual(['typeof value === "object" && value !== null && !Array.isArray(value)'])
  })

  it('skips required check when required array is empty', () => {
    const result = generateSchemaChecks('value', { type: 'object', required: [] })
    expect(result).toEqual(['typeof value === "object" && value !== null && !Array.isArray(value)'])
  })

  it('appends enum check regardless of type', () => {
    const result = generateSchemaChecks('value', { type: 'string', enum: ['a', 'b'] })
    expect(result).toContain('typeof value === "string"')
    expect(result).toContain('["a","b"].includes(value as never)')
  })

  it('does not append enum check when enum is empty', () => {
    const result = generateSchemaChecks('value', { type: 'string', enum: [] })
    expect(result).toEqual(['typeof value === "string"'])
  })

  it('uses the provided accessor in all checks', () => {
    const result = generateSchemaChecks('input?.name', { type: 'string', minLength: 1 })
    expect(result).toEqual(['typeof input?.name === "string"', 'input?.name.length >= 1'])
  })
})
