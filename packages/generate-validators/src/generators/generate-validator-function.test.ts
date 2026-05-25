import { describe, expect, it } from 'vitest'

import { generateValidatorFunction } from './generate-validator-function'

// Eval helper: compiles a generated function string in context of a minimal
// ValidationResult runtime so we can actually run the generated code.
const _evalValidator = (code: string): ((input: unknown, path?: string) => unknown) => {
  const _wrapped = `
    const ValidationResult = null // type-only
    ${code}
  `
  // eslint-disable-next-line no-new-func
  return new Function(`
    ${code}
    return validate${code.match(/export const validate(\w+)/)?.[1] ?? ''}
  `)() as (input: unknown, path?: string) => unknown
}

describe('generate-validator-function', () => {
  it('generates a validator for a required string property', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: { type: 'string' as const } },
      required: ['name'],
    }
    const code = generateValidatorFunction(schema, 'Info')

    expect(code).toContain('export const validateInfo')
    expect(code).toContain('"name" in obj')
    expect(code).toContain("must have required property 'name'")
    expect(code).toContain('typeof obj["name"] !== \'string\'')
    expect(code).toContain('must be string')
  })

  it('generates a validator for an optional number property', () => {
    const schema = {
      type: 'object' as const,
      properties: { count: { type: 'number' as const } },
    }
    const code = generateValidatorFunction(schema, 'Stats')

    expect(code).toContain('obj["count"] !== undefined')
    expect(code).toContain('typeof obj["count"] !== \'number\'')
    expect(code).toContain('must be number')
  })

  it('generates a validator for a boolean property', () => {
    const schema = {
      type: 'object' as const,
      properties: { enabled: { type: 'boolean' as const } },
      required: ['enabled'],
    }
    const code = generateValidatorFunction(schema, 'Config')

    expect(code).toContain('typeof obj["enabled"] !== \'boolean\'')
    expect(code).toContain('must be boolean')
  })

  it('generates required-property check at parent path', () => {
    const schema = {
      type: 'object' as const,
      properties: { title: { type: 'string' as const } },
      required: ['title'],
    }
    const code = generateValidatorFunction(schema, 'Doc')

    // Required errors use _path (parent), not a child path
    expect(code).toContain('path: _path')
    expect(code).toContain("must have required property 'title'")
  })

  it('generates type error at child path', () => {
    const schema = {
      type: 'object' as const,
      properties: { title: { type: 'string' as const } },
      required: ['title'],
    }
    const code = generateValidatorFunction(schema, 'Doc')

    // Type errors use the child path
    expect(code).toContain('`${_path}/title`')
  })

  it('generates an enum validator', () => {
    const schema = {
      enum: ['get', 'post', 'put', 'delete'],
    }
    const code = generateValidatorFunction(schema as Parameters<typeof generateValidatorFunction>[0], 'Method')

    expect(code).toContain('must be one of')
    expect(code).toContain('"get"')
    expect(code).toContain('"post"')
  })

  it('generates a string pattern check', () => {
    const schema = {
      type: 'object' as const,
      properties: { version: { type: 'string' as const, pattern: '^\\d+\\.\\d+' } },
      required: ['version'],
    }
    const code = generateValidatorFunction(schema, 'Info')

    expect(code).toContain('must match pattern')
    expect(code).toContain('.test(')
  })

  it('generates min/maxLength checks', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: { type: 'string' as const, minLength: 1, maxLength: 100 } },
      required: ['name'],
    }
    const code = generateValidatorFunction(schema, 'Info')

    expect(code).toContain('must have at least 1 characters')
    expect(code).toContain('must have at most 100 characters')
  })

  it('generates minimum/maximum checks', () => {
    const schema = {
      type: 'object' as const,
      properties: { port: { type: 'number' as const, minimum: 0, maximum: 65535 } },
    }
    const code = generateValidatorFunction(schema, 'Server')

    expect(code).toContain('>= 0')
    expect(code).toContain('<= 65535')
  })

  it('generates a $ref property delegation', () => {
    const schema = {
      type: 'object' as const,
      properties: { info: { $ref: '#/$defs/info' } },
      required: ['info'],
    }
    const code = generateValidatorFunction(schema, 'Document')

    expect(code).toContain('validateInfoObject(')
    expect(code).toContain('"info" in obj')
  })

  it('generates a scalar string validator', () => {
    const schema = { type: 'string' as const }
    const code = generateValidatorFunction(schema, 'StringValue')

    expect(code).toContain("typeof input !== 'string'")
    expect(code).toContain('must be string')
  })

  it('accumulates all constraint errors for a scalar string schema', () => {
    const schema = { type: 'string' as const, pattern: '^\\d+$', minLength: 2, maxLength: 4 }
    const code = generateValidatorFunction(schema, 'Code')

    // All three constraints push onto a shared errors array instead of returning early
    expect(code).toContain('const errors: ValidationError[] = []')
    expect(code).toContain("errors.push({ message: 'must match pattern")
    expect(code).toContain("errors.push({ message: 'must have at least 2 characters'")
    expect(code).toContain("errors.push({ message: 'must have at most 4 characters'")
    expect(code).toContain('return errors.length > 0 ? { valid: false, errors } : true')
  })

  it('returns true for empty object schemas', () => {
    const schema = { type: 'object' as const }
    const code = generateValidatorFunction(schema, 'Empty')

    expect(code).toContain('validateEmpty')
    expect(code).toContain('must be object')
    expect(code).toContain('return errors.length > 0')
  })

  it('generates object guard at top of object validator', () => {
    const schema = { type: 'object' as const, properties: { x: { type: 'string' as const } } }
    const code = generateValidatorFunction(schema, 'Foo')

    expect(code).toContain("typeof input !== 'object'")
    expect(code).toContain('Array.isArray(input)')
    expect(code).toContain('must be object')
  })

  it('generates an instanceof check for a required x-mjst Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
      required: ['createdAt'],
    }
    const code = generateValidatorFunction(schema, 'Event')

    expect(code).toContain('"createdAt" in obj')
    expect(code).toContain('!(obj["createdAt"] instanceof Date)')
    expect(code).toContain('must be Date')
  })

  it('generates an instanceof check for an optional x-mjst Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
    }
    const code = generateValidatorFunction(schema, 'Event')

    expect(code).toContain('obj["createdAt"] !== undefined && !(obj["createdAt"] instanceof Date)')
  })

  it('generates an instanceof check for a top-level x-mjst Date schema', () => {
    const code = generateValidatorFunction({ 'x-mjst': { instanceOf: 'Date' } }, 'When')

    expect(code).toContain('!(input instanceof Date)')
    expect(code).toContain('must be Date')
  })

  it('generates a typeof check for a required x-mjst bigint property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
      required: ['balance'],
    }
    const code = generateValidatorFunction(schema, 'Account')

    expect(code).toContain('typeof obj["balance"] !== "bigint"')
    expect(code).toContain('must be bigint')
  })

  it('guards undefined for an optional x-mjst bigint property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
    }
    const code = generateValidatorFunction(schema, 'Account')

    expect(code).toContain('obj["balance"] !== undefined && typeof obj["balance"] !== "bigint"')
  })

  it('generates a typeof check for a top-level x-mjst bigint schema', () => {
    const code = generateValidatorFunction({ 'x-mjst': { primitive: 'bigint' } }, 'Big')

    expect(code).toContain('typeof input !== "bigint"')
    expect(code).toContain('must be bigint')
  })
})
