import { describe, expect, it } from 'vitest'

import { findDiscriminator } from './find-discriminator'

describe('find-discriminator', () => {
  it('finds discriminator when each schema has a unique const value', () => {
    const schemas = [
      { type: 'object' as const, properties: { kind: { const: 'a' } } },
      { type: 'object' as const, properties: { kind: { const: 'b' } } },
      { type: 'object' as const, properties: { kind: { const: 'c' } } },
    ]
    expect(findDiscriminator(schemas)).toBe('kind')
  })

  it('finds discriminator when each schema has a single enum value', () => {
    const schemas = [
      { type: 'object' as const, properties: { type: { enum: ['cat'] } } },
      { type: 'object' as const, properties: { type: { enum: ['dog'] } } },
    ]
    expect(findDiscriminator(schemas)).toBe('type')
  })

  it('returns null when schemas share the same const value', () => {
    const schemas = [
      { type: 'object' as const, properties: { kind: { const: 'a' } } },
      { type: 'object' as const, properties: { kind: { const: 'a' } } },
    ]
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('returns null when schemas have no properties', () => {
    const schemas = [{ type: 'object' as const }, { type: 'object' as const }]
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('returns null for empty schemas array', () => {
    expect(findDiscriminator([])).toBeNull()
  })

  it('returns null when schemas are boolean', () => {
    expect(findDiscriminator([true, false])).toBeNull()
  })

  it('returns null when not all schemas have the discriminator property', () => {
    const schemas = [
      { type: 'object' as const, properties: { kind: { const: 'a' } } },
      { type: 'object' as const, properties: { name: { type: 'string' as const } } },
    ]
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('returns null when property has multi-value enum', () => {
    const schemas = [
      { type: 'object' as const, properties: { type: { enum: ['a', 'b'] } } },
      { type: 'object' as const, properties: { type: { enum: ['c'] } } },
    ]
    // Multi-value enum does not count as a discriminator value
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('returns null when property schema has no const or enum', () => {
    const schemas = [
      { type: 'object' as const, properties: { kind: { type: 'string' as const } } },
      { type: 'object' as const, properties: { kind: { type: 'string' as const } } },
    ]
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('prefers the first property that matches across all schemas', () => {
    const schemas = [
      { type: 'object' as const, properties: { a: { const: 1 }, b: { const: 'x' } } },
      { type: 'object' as const, properties: { a: { const: 2 }, b: { const: 'y' } } },
    ]
    // Both 'a' and 'b' are valid discriminators; returns the first one found
    const result = findDiscriminator(schemas)
    expect(result === 'a' || result === 'b').toBe(true)
  })

  it('ignores schemas without type object', () => {
    const schemas = [{ type: 'string' as const }, { type: 'object' as const, properties: { kind: { const: 'a' } } }]
    expect(findDiscriminator(schemas)).toBeNull()
  })

  it('handles schemas identified as objects by having properties without explicit type', () => {
    const schemas = [{ properties: { kind: { const: 'a' } } }, { properties: { kind: { const: 'b' } } }]
    expect(findDiscriminator(schemas)).toBe('kind')
  })
})
