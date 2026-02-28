import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'bun:test'
import { applySchemaExtensions } from '#parser/helpers/apply-schema-extensions'

describe('apply-schema-extensions', () => {
  it('merges extension properties into schema properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        'x-enabled': { type: 'boolean' },
      },
      required: ['name'],
    })
  })

  it('returns original schema when no extensions match the definition name', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      operation: {
        'x-codegen': { type: 'string' },
      },
    })

    expect(result).toBe(schema)
  })

  it('returns original schema when extensions record is empty', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = applySchemaExtensions(schema, 'parameter', {})

    expect(result).toBe(schema)
  })

  it('returns original schema when matching extensions have no properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      parameter: {},
    })

    expect(result).toBe(schema)
  })

  it('returns boolean schema unchanged', () => {
    const result = applySchemaExtensions(true, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    expect(result).toBe(true)
  })

  it('adds properties to a schema that has no existing properties', () => {
    const schema: JSONSchema = {
      type: 'object',
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    expect(result).toEqual({
      type: 'object',
      properties: {
        'x-enabled': { type: 'boolean' },
      },
    })
  })

  it('merges multiple extension properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
        'x-internal': { type: 'boolean', default: false },
        'x-display-name': { type: 'string' },
      },
    })

    const properties = (result as Record<string, unknown>)['properties'] as Record<string, unknown>
    expect(Object.keys(properties)).toEqual(['name', 'x-enabled', 'x-internal', 'x-display-name'])
  })

  it('does not modify the required array', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    }

    const result = applySchemaExtensions(schema, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    expect((result as Record<string, unknown>)['required']).toEqual(['name'])
  })

  it('handles complex extension schemas', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = applySchemaExtensions(schema, 'operation', {
      operation: {
        'x-codegen': {
          type: 'object',
          properties: {
            methodName: { type: 'string' },
            deprecated: { type: 'boolean' },
          },
          required: ['methodName'],
        },
      },
    })

    const properties = (result as Record<string, unknown>)['properties'] as Record<string, JSONSchema>
    expect(properties['x-codegen']).toEqual({
      type: 'object',
      properties: {
        methodName: { type: 'string' },
        deprecated: { type: 'boolean' },
      },
      required: ['methodName'],
    })
  })

  it('does not mutate the original schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const originalProperties = { ...(schema as Record<string, unknown>)['properties'] as Record<string, unknown> }

    applySchemaExtensions(schema, 'parameter', {
      parameter: {
        'x-enabled': { type: 'boolean' },
      },
    })

    expect((schema as Record<string, unknown>)['properties']).toEqual(originalProperties)
  })
})
