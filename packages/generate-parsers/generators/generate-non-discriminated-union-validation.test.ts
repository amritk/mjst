import { describe, expect, it } from 'bun:test'
import { generateNonDiscriminatedUnionValidation } from './generate-non-discriminated-union-validation'

describe('generate-non-discriminated-union-validation', () => {
  it('generates OR chain for multiple schema checks', () => {
    const schemas = [
      { type: 'string' as const },
      { type: 'number' as const },
    ]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', true)
    expect(result).toContain('typeof value === "string"')
    expect(result).toContain('typeof value === "number"')
    expect(result).toContain('||')
  })

  it('returns fallback with nullish coalescing when required and no checks', () => {
    const schemas = [{ description: 'no type' }]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', true)
    expect(result).toBe('value ?? ""')
  })

  it('returns accessor when not required and no checks', () => {
    const schemas = [{ description: 'no type' }]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', false)
    expect(result).toBe('value')
  })

  it('wraps valid check in ternary with default value when required', () => {
    const schemas = [{ type: 'string' as const }]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', true)
    expect(result).toBe('((typeof value === "string")) ? value : ""')
  })

  it('uses undefined as fallback when not required', () => {
    const schemas = [{ type: 'string' as const }]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', false)
    expect(result).toBe('((typeof value === "string")) ? value : undefined')
  })

  it('handles schemas with multiple constraints combined with &&', () => {
    const schemas = [
      { type: 'string' as const, minLength: 1, maxLength: 100 },
    ]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, '""', true)
    expect(result).toContain('typeof value === "string"')
    expect(result).toContain('value.length >= 1')
    expect(result).toContain('value.length <= 100')
    expect(result).toContain('&&')
  })

  it('handles empty schemas array when required', () => {
    const result = generateNonDiscriminatedUnionValidation('value', [], '""', true)
    expect(result).toBe('value ?? ""')
  })

  it('handles empty schemas array when not required', () => {
    const result = generateNonDiscriminatedUnionValidation('value', [], '""', false)
    expect(result).toBe('value')
  })

  it('generates multiple OR groups for different types', () => {
    const schemas = [
      { type: 'string' as const },
      { type: 'number' as const },
      { type: 'boolean' as const },
    ]
    const result = generateNonDiscriminatedUnionValidation('value', schemas, 'null', true)
    expect(result).toContain('typeof value === "string"')
    expect(result).toContain('typeof value === "number"')
    expect(result).toContain('typeof value === "boolean"')
    // Should use || between groups
    const orCount = (result.match(/\|\|/g) || []).length
    expect(orCount).toBe(2)
  })

  it('uses the provided accessor throughout', () => {
    const schemas = [{ type: 'string' as const }]
    const result = generateNonDiscriminatedUnionValidation('input?.name', schemas, '""', true)
    expect(result).toContain('typeof input?.name === "string"')
    expect(result).toContain('input?.name :')
  })
})
