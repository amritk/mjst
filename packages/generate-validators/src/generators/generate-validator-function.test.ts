import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateValidatorFunction } from './generate-validator-function'

/**
 * Compiles a generated validator (TypeScript source) to JavaScript and returns
 * the exported function, so tests can run real inputs through the emitted code
 * instead of only asserting on its text.
 */
const evalValidator = (code: string): ((input: unknown, path?: string) => unknown) => {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', js)(moduleExports)
  const name = Object.keys(moduleExports).find((exportName) => exportName.startsWith('validate'))
  return moduleExports[name ?? ''] as (input: unknown, path?: string) => unknown
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

  it('escapes forward slashes in a pattern so the emitted regex literal compiles', () => {
    const schema = {
      type: 'object' as const,
      properties: { date: { type: 'string' as const, pattern: '^\\d{4}/\\d{2}/\\d{2}$' } },
      required: ['date'],
    }
    const code = generateValidatorFunction(schema, 'Event')

    // The bare slashes are escaped (\/) and the digit classes keep their single
    // backslash, so the literal is valid and means what the pattern says.
    expect(code).toContain('!/^\\d{4}\\/\\d{2}\\/\\d{2}$/.test(')
    // Sanity check: the emitted regex source actually parses and matches.
    const emitted = /!\/(.+)\/\.test\(/.exec(code)?.[1]
    expect(emitted).toBeDefined()
    expect(new RegExp(emitted as string).test('2024/01/02')).toBe(true)
  })

  it('checks a const property for an exact value', () => {
    const schema = {
      type: 'object' as const,
      properties: { kind: { const: 'user' }, version: { const: 2 } },
      required: ['kind'],
    }
    const code = generateValidatorFunction(schema, 'Record')

    expect(code).toContain('obj["kind"] !== "user"')
    expect(code).toContain('obj["version"] !== 2')
    expect(code).toContain('must be \\"user\\"')
  })

  it('checks a const object property by order-independent deep equality', () => {
    const schema = {
      type: 'object' as const,
      properties: { meta: { const: { a: 1 } } },
    }
    const code = generateValidatorFunction(schema, 'Record')

    expect(code).toContain('!valuesEqual(obj["meta"], {"a":1})')
  })

  it('generates a top-level const validator', () => {
    const code = generateValidatorFunction({ const: 'fixed' }, 'Tag')

    expect(code).toContain('input !== "fixed"')
    expect(code).toContain('must be \\"fixed\\"')
  })

  it('generates dependentRequired presence checks', () => {
    const schema = {
      type: 'object' as const,
      properties: { creditCard: { type: 'number' as const }, billingAddress: { type: 'string' as const } },
      dependentRequired: { creditCard: ['billingAddress'] },
    }
    const code = generateValidatorFunction(schema, 'Payment')

    expect(code).toContain('"creditCard" in obj && !("billingAddress" in obj)')
    expect(code).toContain("must have property 'billingAddress' when 'creditCard' is present")
  })

  it('generates a propertyNames pattern check over every key', () => {
    const schema = {
      type: 'object' as const,
      propertyNames: { pattern: '^[a-z]+$' },
    }
    const code = generateValidatorFunction(schema, 'Dict')

    expect(code).toContain('for (const _name of Object.keys(obj))')
    expect(code).toContain('!/^[a-z]+$/.test(_name)')
    expect(code).toContain('property name must match pattern')
  })

  it('generates propertyNames checks beyond pattern (length, enum, const, $ref)', () => {
    expect(generateValidatorFunction({ type: 'object', propertyNames: { maxLength: 3 } }, 'Dict')).toContain(
      '_name.length > 3',
    )
    expect(generateValidatorFunction({ type: 'object', propertyNames: { enum: ['a', 'b'] } }, 'Dict')).toContain(
      '.includes(_name)',
    )
    expect(generateValidatorFunction({ type: 'object', propertyNames: { const: 'only' } }, 'Dict')).toContain(
      '_name !== "only"',
    )
    expect(generateValidatorFunction({ type: 'object', propertyNames: { $ref: '#/$defs/key' } }, 'Dict')).toContain(
      'validateKey(_name',
    )
  })

  it('honours the draft-04 boolean exclusiveMinimum/exclusiveMaximum form', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        n: { type: 'number' as const, minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true },
      },
    }
    const code = generateValidatorFunction(schema, 'Bounds')

    // A strict bound flips `<`/`>` to `<=`/`>=` so the boundary itself is rejected.
    expect(code).toContain('<= 0')
    expect(code).toContain('must be > 0')
    expect(code).toContain('>= 10')
    expect(code).toContain('must be < 10')
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

    expect(code).toContain('validateInfo(')
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
    expect(code).toContain('errors.push({ message: "must match pattern')
    // The pattern body keeps its backslash (\d), so the emitted literal is a digit class.
    expect(code).toContain('!/^\\d+$/.test(input)')
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

  it('validates the fields of an inline nested object', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        profile: {
          type: 'object' as const,
          properties: { name: { type: 'string' as const }, age: { type: 'number' as const } },
          required: ['name'],
        },
      },
      required: ['profile'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'User'))

    expect(validate({ profile: { name: 'Ada', age: 36 } })).toBe(true)
    expect(validate({ profile: { name: 42 } })).toEqual({
      valid: false,
      errors: [{ message: 'must be string', path: '/profile/name' }],
    })
  })

  it('reports a missing required nested property at the nested parent path', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        profile: {
          type: 'object' as const,
          properties: { name: { type: 'string' as const } },
          required: ['name'],
        },
      },
      required: ['profile'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'User'))

    expect(validate({ profile: {} })).toEqual({
      valid: false,
      errors: [{ message: "must have required property 'name'", path: '/profile' }],
    })
  })

  it('validates inline objects nested more than one level deep', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        outer: {
          type: 'object' as const,
          properties: {
            inner: {
              type: 'object' as const,
              properties: { leaf: { type: 'boolean' as const } },
              required: ['leaf'],
            },
          },
          required: ['inner'],
        },
      },
      required: ['outer'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'Tree'))

    expect(validate({ outer: { inner: { leaf: true } } })).toBe(true)
    expect(validate({ outer: { inner: { leaf: 'no' } } })).toEqual({
      valid: false,
      errors: [{ message: 'must be boolean', path: '/outer/inner/leaf' }],
    })
  })

  it('rejects undeclared keys when additionalProperties is false', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'number' as const } },
      required: ['id'],
      additionalProperties: false,
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'Strict'))

    expect(validate({ id: 1 })).toBe(true)
    expect(validate({ id: 1, extra: 'nope' })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/extra' }],
    })
  })

  it('inlines !== comparisons for the strict sweep below the key threshold', () => {
    // A handful of known keys compile to a comparison chain (no Set allocation),
    // which V8 evaluates faster than Set.has — the same shape Ajv/TypeBox emit.
    const schema = {
      type: 'object' as const,
      properties: { number: { type: 'number' as const }, negNumber: { type: 'number' as const } },
      additionalProperties: false,
    }
    const code = generateValidatorFunction(schema, 'Bench')

    expect(code).toContain('_key0 !== "number" && _key0 !== "negNumber"')
    expect(code).not.toContain('new Set')
    expect(code).not.toContain('.has(_key0)')
  })

  it('falls back to a hoisted Set when the strict sweep exceeds the key threshold', () => {
    const properties = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, { type: 'string' as const }]))
    const schema = { type: 'object' as const, properties, additionalProperties: false }
    const code = generateValidatorFunction(schema, 'Wide')

    expect(code).toContain('new Set(')
    expect(code).toContain('.has(_key0)')
  })

  it('rejects every key for additionalProperties false with no declared properties', () => {
    const schema = { type: 'object' as const, additionalProperties: false }
    const validate = evalValidator(generateValidatorFunction(schema, 'Empty'))

    expect(validate({})).toBe(true)
    expect(validate({ extra: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/extra' }],
    })
  })

  it('rejects undeclared nested keys when the nested object sets additionalProperties false', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        nested: {
          type: 'object' as const,
          properties: { a: { type: 'string' as const } },
          additionalProperties: false,
        },
      },
      required: ['nested'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'Strict'))

    expect(validate({ nested: { a: 'ok' } })).toBe(true)
    expect(validate({ nested: { a: 'ok', b: 'extra' } })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/nested/b' }],
    })
  })

  it('allows undeclared keys when additionalProperties is absent', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'number' as const } },
      required: ['id'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'Loose'))

    expect(validate({ id: 1, extra: 'fine' })).toBe(true)
  })

  it('allows pattern-matched keys but rejects others when additionalProperties is false', () => {
    // Mirrors the interpreter: a key matching any `patternProperties` regex is
    // not "additional"; only keys outside both `properties` and every pattern
    // are rejected.
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'number' as const } },
      patternProperties: { '^x-': { type: 'string' as const } },
      additionalProperties: false,
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'Extensible'))

    expect(validate({ id: 1 })).toBe(true)
    expect(validate({ id: 1, 'x-foo': 'ok' })).toBe(true)
    expect(validate({ id: 1, 'x-foo': 'ok', 'x-bar': 'also ok' })).toBe(true)
    expect(validate({ id: 1, nope: 'bad' })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/nope' }],
    })
  })

  it('allows keys matching any of several patterns under additionalProperties false', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'number' as const } },
      patternProperties: {
        '^x-': { type: 'string' as const },
        _count$: { type: 'number' as const },
      },
      additionalProperties: false,
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'MultiPattern'))

    expect(validate({ id: 1, 'x-foo': 'ok', item_count: 3 })).toBe(true)
    expect(validate({ id: 1, stray: true })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/stray' }],
    })
  })

  it('rejects keys matching no pattern at nested levels under additionalProperties false', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        nested: {
          type: 'object' as const,
          properties: { a: { type: 'string' as const } },
          patternProperties: { '^x-': { type: 'string' as const } },
          additionalProperties: false,
        },
      },
      required: ['nested'],
    }
    const validate = evalValidator(generateValidatorFunction(schema, 'NestedPattern'))

    expect(validate({ nested: { a: 'ok', 'x-meta': 'fine' } })).toBe(true)
    expect(validate({ nested: { a: 'ok', b: 'extra' } })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/nested/b' }],
    })
  })

  it('reports array item errors at the item index path', () => {
    const schema = {
      type: 'object' as const,
      properties: { tags: { type: 'array' as const, items: { type: 'string' as const } } },
      required: ['tags'],
    }
    const code = generateValidatorFunction(schema, 'Post')

    expect(code).toContain('`${_path}/tags/${_i}`')

    const validate = evalValidator(code)
    expect(validate({ tags: ['a', 42] })).toEqual({
      valid: false,
      errors: [{ message: 'items must be string', path: '/tags/1' }],
    })
  })
})
