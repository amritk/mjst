import { describe, expect, it } from 'vitest'

import { generateDiscriminatedUnionValidation } from './generate-discriminated-union-validation'

describe('generate-discriminated-union-validation', () => {
  it('generates ternary chain for schemas with discriminator values', () => {
    const schemas = [
      {
        type: 'object' as const,
        properties: { kind: { const: 'a' }, name: { type: 'string' as const } },
      },
      {
        type: 'object' as const,
        properties: { kind: { const: 'b' }, count: { type: 'number' as const } },
      },
    ]
    const result = generateDiscriminatedUnionValidation('value', schemas, 'kind', '{}', true)
    expect(result).toContain('value?.kind === "a"')
    expect(result).toContain('value?.kind === "b"')
  })

  it('returns fallback expression when no schemas have discriminator values', () => {
    const schemas = [{ type: 'object' as const, properties: { name: { type: 'string' as const } } }]
    const result = generateDiscriminatedUnionValidation('value', schemas, 'kind', '{}', true)
    expect(result).toBe('value ?? {}')
  })

  it('returns accessor when not required and no discriminator values', () => {
    const schemas = [{ type: 'object' as const, properties: { name: { type: 'string' as const } } }]
    const result = generateDiscriminatedUnionValidation('value', schemas, 'kind', '{}', false)
    expect(result).toBe('value')
  })

  it('includes schema checks in ternary when type checks exist', () => {
    const schemas = [
      {
        type: 'object' as const,
        properties: { kind: { const: 'user' } },
      },
    ]
    const result = generateDiscriminatedUnionValidation('input', schemas, 'kind', '{}', true)
    expect(result).toContain('input?.kind === "user"')
    // Should include object type checks
    expect(result).toContain('typeof input === "object"')
  })

  it('handles schemas with single enum values as discriminators', () => {
    const schemas = [
      {
        type: 'object' as const,
        properties: { type: { enum: ['cat'] } },
      },
      {
        type: 'object' as const,
        properties: { type: { enum: ['dog'] } },
      },
    ]
    const result = generateDiscriminatedUnionValidation('value', schemas, 'type', '{}', true)
    expect(result).toContain('value?.type === "cat"')
    expect(result).toContain('value?.type === "dog"')
  })

  it('handles empty schemas array', () => {
    const result = generateDiscriminatedUnionValidation('value', [], 'type', '{}', true)
    expect(result).toBe('value ?? {}')
  })

  it('skips schemas without a discriminator value', () => {
    const schemas = [
      {
        type: 'object' as const,
        properties: { kind: { const: 'a' } },
      },
      {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
      },
    ]
    const result = generateDiscriminatedUnionValidation('value', schemas, 'kind', '{}', true)
    expect(result).toContain('value?.kind === "a"')
    // The second schema has no discriminator, so it does not appear in the ternary chain
    expect(result).not.toContain('value?.kind === undefined')
  })
})
