import { describe, expect, it } from 'bun:test'
import { resolveDynamicRefs } from '#parser/helpers/resolve-dynamic-refs'

describe('resolve-dynamic-refs', () => {
  it('replaces $dynamicRef with $ref in properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    expect(result).toEqual({
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
      },
    })
  })

  it('replaces $dynamicRef in additionalProperties', () => {
    const schema = {
      type: 'object' as const,
      additionalProperties: { $dynamicRef: '#meta' },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    expect(result).toEqual({
      type: 'object',
      additionalProperties: { $ref: '#/$defs/schema' },
    })
  })

  it('does not mutate the original schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    // Original should be unchanged
    expect(schema.properties.schema).toEqual({ $dynamicRef: '#meta' })
  })

  it('returns schema unchanged when dynamicRefMap is empty', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    const result = resolveDynamicRefs(schema, {})

    expect(result).toEqual(schema)
  })

  it('returns non-object schemas unchanged', () => {
    expect(resolveDynamicRefs(true, { '#meta': '#/$defs/schema' })).toBe(true)
    expect(resolveDynamicRefs(false, { '#meta': '#/$defs/schema' })).toBe(false)
  })

  it('handles nested $dynamicRef in property sub-schemas', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schemas: {
          type: 'object' as const,
          additionalProperties: { $dynamicRef: '#meta' },
        },
      },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    const expected = {
      type: 'object',
      properties: {
        schemas: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/schema' },
        },
      },
    }
    expect(result).toEqual(expected)
  })
})
