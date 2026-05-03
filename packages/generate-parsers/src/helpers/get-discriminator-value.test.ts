import { describe, expect, it } from 'bun:test'

import { getDiscriminatorValue } from './get-discriminator-value'

describe('get-discriminator-value', () => {
  it('returns const value from discriminator property', () => {
    const schema = {
      type: 'object' as const,
      properties: { kind: { const: 'user' } },
    }
    expect(getDiscriminatorValue(schema, 'kind')).toBe('user')
  })

  it('returns single enum value from discriminator property', () => {
    const schema = {
      type: 'object' as const,
      properties: { type: { enum: ['admin'] } },
    }
    expect(getDiscriminatorValue(schema, 'type')).toBe('admin')
  })

  it('returns null when property has multi-value enum', () => {
    const schema = {
      type: 'object' as const,
      properties: { type: { enum: ['admin', 'user'] } },
    }
    expect(getDiscriminatorValue(schema, 'type')).toBeNull()
  })

  it('returns null when discriminator key does not exist in properties', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: { type: 'string' as const } },
    }
    expect(getDiscriminatorValue(schema, 'kind')).toBeNull()
  })

  it('returns null when schema has no properties', () => {
    const schema = { type: 'object' as const }
    expect(getDiscriminatorValue(schema, 'kind')).toBeNull()
  })

  it('returns null for non-object schema', () => {
    const schema = { type: 'string' as const }
    expect(getDiscriminatorValue(schema, 'kind')).toBeNull()
  })

  it('returns null for boolean schema', () => {
    expect(getDiscriminatorValue(true, 'kind')).toBeNull()
    expect(getDiscriminatorValue(false, 'kind')).toBeNull()
  })

  it('returns null when property schema is a boolean', () => {
    const schema = {
      type: 'object' as const,
      properties: { kind: true },
    }
    expect(getDiscriminatorValue(schema, 'kind')).toBeNull()
  })

  it('returns null when property has no const or enum', () => {
    const schema = {
      type: 'object' as const,
      properties: { kind: { type: 'string' as const } },
    }
    expect(getDiscriminatorValue(schema, 'kind')).toBeNull()
  })

  it('returns numeric const value', () => {
    const schema = {
      type: 'object' as const,
      properties: { version: { const: 2 } },
    }
    expect(getDiscriminatorValue(schema, 'version')).toBe(2)
  })

  it('handles schema with properties but no explicit type', () => {
    const schema = {
      properties: { kind: { const: 'test' } },
    }
    expect(getDiscriminatorValue(schema, 'kind')).toBe('test')
  })
})
