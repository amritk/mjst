import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

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

    // All three constraints push onto a lazily-allocated errors array (created on
    // the first error) instead of returning early, so valid input allocates nothing.
    expect(code).toContain('let errors: ValidationError[] | undefined')
    expect(code).toContain('(errors ??= []).push({ message: "must match pattern')
    // The pattern body keeps its backslash (\d), so the emitted literal is a digit class.
    expect(code).toContain('!/^\\d+$/.test(input)')
    expect(code).toContain("(errors ??= []).push({ message: 'must have at least 2 characters'")
    expect(code).toContain("(errors ??= []).push({ message: 'must have at most 4 characters'")
    expect(code).toContain('return errors !== undefined ? { valid: false, errors } : true')
  })

  it('returns true for empty object schemas', () => {
    const schema = { type: 'object' as const }
    const code = generateValidatorFunction(schema, 'Empty')

    expect(code).toContain('validateEmpty')
    expect(code).toContain('must be object')
    expect(code).toContain('return errors !== undefined')
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

  describe('happy-path guard', () => {
    // The early `return true` block (an `&&` chain that proves validity without
    // allocating an errors array) only appears when the guard is emitted; the
    // slow path's final return is `... : true`, never a bare `return true`.
    const hasGuard = (code: string): boolean => code.includes('  ) {\n    return true\n  }')

    it('emits a boolean guard for an all-required object of bare-typed scalars', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const }, age: { type: 'number' as const } },
        required: ['name', 'age'],
      }
      const code = generateValidatorFunction(schema, 'Person')

      expect(hasGuard(code)).toBe(true)
      // Member access into obj is guarded by the object-shape check ahead of it.
      // The `!Array.isArray` term is dropped: the required `name`/`age` typeof
      // checks already reject an array (`[].name` is undefined), so it's dead weight.
      expect(code).toContain("typeof input === 'object' && input !== null &&")
      expect(code).not.toContain('!Array.isArray(input)')
      // Identifier keys use dotted access in the guard.
      expect(code).toContain("typeof obj.name === 'string'")
      expect(code).toContain("typeof obj.age === 'number'")
    })

    it('keeps !Array.isArray in the guard when no required field check would reject an array', () => {
      // `length` is the one string key an array carries a real (numeric) value
      // for, so `typeof obj["length"] === 'number'` does NOT rule out an array —
      // the explicit array check has to stay or `[]` would pass the guard.
      const schema = {
        type: 'object' as const,
        properties: { length: { type: 'number' as const } },
        required: ['length'],
      }
      const code = generateValidatorFunction(schema, 'Lengthy')

      expect(hasGuard(code)).toBe(true)
      expect(code).toContain("typeof input === 'object' && input !== null && !Array.isArray(input)")
      // The guard must reject an array even though `[].length` is a number.
      expect(evalValidator(code)([])).toEqual({
        valid: false,
        errors: [{ message: 'must be object', path: '' }],
      })
    })

    it('proves validity for the happy path and falls through to identical errors otherwise', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const }, age: { type: 'number' as const } },
        required: ['name', 'age'],
      }
      const validate = evalValidator(generateValidatorFunction(schema, 'Person'))

      expect(validate({ name: 'Ada', age: 36 })).toBe(true)
      // A bad property type falls through the guard to the slow, error-collecting path.
      expect(validate({ name: 'Ada', age: 'old' })).toEqual({
        valid: false,
        errors: [{ message: 'must be number', path: '/age' }],
      })
      // A missing required property likewise falls through to the slow path.
      expect(validate({ name: 'Ada' })).toEqual({
        valid: false,
        errors: [{ message: "must have required property 'age'", path: '' }],
      })
      // Non-object input is rejected by the slow path's object guard, not the fast one.
      expect(validate(null)).toEqual({
        valid: false,
        errors: [{ message: 'must be object', path: '' }],
      })
    })

    it('uses an exact key count instead of a sweep for strict all-required objects', () => {
      const schema = {
        type: 'object' as const,
        properties: { id: { type: 'number' as const } },
        required: ['id'],
        additionalProperties: false,
      }
      const code = generateValidatorFunction(schema, 'Strict')

      expect(hasGuard(code)).toBe(true)
      expect(code).toContain('Object.keys(obj).length === 1')

      const validate = evalValidator(code)
      expect(validate({ id: 1 })).toBe(true)
      // An extra key bumps the count past 1, so the guard bails and the slow
      // path reports the additional property.
      expect(validate({ id: 1, extra: 'x' })).toEqual({
        valid: false,
        errors: [{ message: 'must NOT have additional properties', path: '/extra' }],
      })
    })

    it('inlines a guard for guardable nested objects, casting through each level', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          p: {
            type: 'object' as const,
            properties: { n: { type: 'string' as const } },
            required: ['n'],
          },
        },
        required: ['p'],
      }
      const code = generateValidatorFunction(schema, 'Wrap')

      expect(hasGuard(code)).toBe(true)
      // The nested object's guard uses dotted access and drops its own array
      // check (the required `n` string check already rejects an array for `p`).
      expect(code).toContain("typeof obj.p === 'object' && obj.p !== null &&")
      expect(code).toContain("typeof (obj.p as Record<string, unknown>).n === 'string'")

      const validate = evalValidator(code)
      expect(validate({ p: { n: 'ok' } })).toBe(true)
      // A non-object (array) at `p` still falls through to the slow path.
      expect(validate({ p: [] })).toEqual({
        valid: false,
        errors: [{ message: 'must be object', path: '/p' }],
      })
      expect(validate({ p: { n: 7 } })).toEqual({
        valid: false,
        errors: [{ message: 'must be string', path: '/p/n' }],
      })
    })

    it('enforces integrality for integer in both the guard and the slow path', () => {
      const schema = {
        type: 'object' as const,
        properties: { count: { type: 'integer' as const } },
        required: ['count'],
      }
      const code = generateValidatorFunction(schema, 'Counter')

      expect(code).toContain('Number.isInteger(obj.count)')
      const validate = evalValidator(code)
      expect(validate({ count: 1 })).toBe(true)
      // A non-integral number is rejected, and the guard agrees with the slow path.
      expect(validate({ count: 1.5 })).toEqual({
        valid: false,
        errors: [{ message: 'must be number', path: '/count' }],
      })
    })

    it('omits the guard when any property is optional', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
      }
      const code = generateValidatorFunction(schema, 'Loose')

      expect(hasGuard(code)).toBe(false)
      expect(evalValidator(code)({})).toBe(true)
    })

    it('omits the guard when a property carries a constraint beyond a bare type', () => {
      const constrained = {
        pattern: { type: 'string' as const, pattern: '^x' },
        enum: { enum: ['a', 'b'] },
        const: { const: 'fixed' },
        minLength: { type: 'string' as const, minLength: 1 },
        minimum: { type: 'number' as const, minimum: 0 },
        ref: { $ref: '#/$defs/other' },
        items: { type: 'array' as const, items: { type: 'string' as const } },
        instanceOf: { 'x-mjst': { instanceOf: 'Date' } },
      }

      for (const [label, prop] of Object.entries(constrained)) {
        const schema = {
          type: 'object' as const,
          properties: { value: prop as Parameters<typeof generateValidatorFunction>[0] },
          required: ['value'],
        }
        const code = generateValidatorFunction(schema, 'T')
        expect(hasGuard(code), `expected no guard for ${label}`).toBe(false)
      }
    })

    it('omits the guard for object-level constraints the cheap expression cannot prove', () => {
      const cases = {
        patternProperties: {
          type: 'object' as const,
          properties: { id: { type: 'number' as const } },
          required: ['id'],
          patternProperties: { '^x-': { type: 'string' as const } },
        },
        propertyNames: {
          type: 'object' as const,
          properties: { id: { type: 'number' as const } },
          required: ['id'],
          propertyNames: { pattern: '^[a-z]+$' },
        },
        dependentRequired: {
          type: 'object' as const,
          properties: { a: { type: 'string' as const }, b: { type: 'string' as const } },
          required: ['a', 'b'],
          dependentRequired: { a: ['b'] },
        },
        additionalPropertiesSchema: {
          type: 'object' as const,
          properties: { id: { type: 'number' as const } },
          required: ['id'],
          additionalProperties: { type: 'string' as const },
        },
      }

      for (const [label, schema] of Object.entries(cases)) {
        const code = generateValidatorFunction(schema as Parameters<typeof generateValidatorFunction>[0], 'T')
        expect(hasGuard(code), `expected no guard for ${label}`).toBe(false)
      }
    })
  })

  describe('boolean type-guard (isX)', () => {
    /**
     * Compiles the validator and its boolean guard together (the guard may fall
     * back to calling the validator) and returns both, so tests can assert the
     * guard's verdict matches `validateX(input) === true` exactly.
     */
    const evalBoth = (
      schema: Parameters<typeof generateValidatorFunction>[0],
      typeName: string,
    ): { validate: (input: unknown) => unknown; guard: (input: unknown) => boolean } => {
      const code = `${generateValidatorFunction(schema, typeName)}\n\n${generateBooleanGuard(schema, typeName)}`
      const js = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText
      const moduleExports: Record<string, unknown> = {}
      new Function('exports', js)(moduleExports)
      return {
        validate: moduleExports[`validate${typeName}`] as (input: unknown) => unknown,
        guard: moduleExports[`is${typeName}`] as (input: unknown) => boolean,
      }
    }

    it('emits an exported `input is T` predicate', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
        required: ['name'],
      }
      const code = generateBooleanGuard(schema, 'User')
      expect(code).toContain('export const isUser = (input: unknown): input is User =>')
      // Flat predicate: no error array, no cold-path call.
      expect(code).not.toContain('errors')
      expect(code).not.toContain('validateUser')
    })

    it('accepts valid input and rejects invalid input', () => {
      const { guard } = evalBoth(
        {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
            age: { type: 'integer' as const, minimum: 0, maximum: 130 },
            active: { type: 'boolean' as const },
          },
          required: ['id', 'age'],
        },
        'User',
      )
      expect(guard({ id: 'x', age: 30 })).toBe(true)
      expect(guard({ id: 'x', age: 30, active: true })).toBe(true)
      expect(guard({ id: 'x' })).toBe(false) // missing required age
      expect(guard({ id: 1, age: 30 })).toBe(false) // wrong type
      expect(guard({ id: 'x', age: -1 })).toBe(false) // below minimum
      expect(guard({ id: 'x', age: 30, active: 'yes' })).toBe(false) // wrong optional type
      expect(guard('nope')).toBe(false)
      expect(guard(null)).toBe(false)
      expect(guard([])).toBe(false)
    })

    it('rejects extras under additionalProperties: false at every level', () => {
      const { guard } = evalBoth(
        {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            a: { type: 'number' as const },
            nested: {
              type: 'object' as const,
              additionalProperties: false,
              properties: { foo: { type: 'string' as const } },
              required: ['foo'],
            },
          },
          required: ['a', 'nested'],
        },
        'T',
      )
      expect(guard({ a: 1, nested: { foo: 'x' } })).toBe(true)
      expect(guard({ a: 1, nested: { foo: 'x' }, extra: true })).toBe(false)
      expect(guard({ a: 1, nested: { foo: 'x', extra: 1 } })).toBe(false)
    })

    it('matches the validator on NaN for a constrained number (both accept it)', () => {
      // The validator uses `typeof === number` + `value < min` (NaN passes both),
      // so the guard must too — `!(value < min)`, not `value >= min`.
      const { validate, guard } = evalBoth(
        {
          type: 'object' as const,
          properties: { n: { type: 'number' as const, minimum: 0, maximum: 10 } },
          required: ['n'],
        },
        'T',
      )
      expect(validate({ n: NaN })).toBe(true)
      expect(guard({ n: NaN })).toBe(true)
      expect(guard({ n: 5 })).toBe(true)
      expect(guard({ n: 20 })).toBe(false)
    })

    it("matches the validator's shallow array-item check (no deep item validation)", () => {
      const { validate, guard } = evalBoth(
        {
          type: 'object' as const,
          properties: {
            items: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                additionalProperties: false,
                properties: { sku: { type: 'string' as const } },
                required: ['sku'],
              },
            },
          },
          required: ['items'],
        },
        'T',
      )
      // The validator only shape-checks object array items, so a bad item field
      // is accepted by both — the guard must not be stricter than the validator.
      const withBadItem = { items: [{ sku: 123, extra: true }] }
      expect(validate(withBadItem)).toBe(true)
      expect(guard(withBadItem)).toBe(true)
      expect(guard({ items: ['not-an-object'] })).toBe(false)
      expect(guard({ items: 'not-an-array' })).toBe(false)
    })

    it('falls back to the validator for schemas it cannot express flat', () => {
      // A $ref defers to the imported validator, which the flat form cannot mirror.
      const schema = {
        type: 'object' as const,
        properties: { child: { $ref: '#/$defs/child' } },
        required: ['child'],
      }
      const code = generateBooleanGuard(schema, 'Parent')
      expect(code).toBe('export const isParent = (input: unknown): input is Parent => validateParent(input) === true')
    })

    it('agrees with `validateX(input) === true` across many mutated inputs', () => {
      const schema = {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          id: { type: 'string' as const, minLength: 1 },
          status: { enum: ['on', 'off'] as const },
          score: { type: 'number' as const, minimum: 0, maximum: 100 },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
          meta: {
            type: 'object' as const,
            additionalProperties: false,
            properties: { k: { type: 'string' as const } },
            required: ['k'],
          },
          note: { type: 'string' as const },
        },
        required: ['id', 'status', 'score', 'meta'],
      }
      const { validate, guard } = evalBoth(schema, 'T')

      const valid = { id: 'a', status: 'on', score: 50, tags: ['x'], meta: { k: 'v' }, note: 'hi' }
      const edges = [undefined, null, NaN, Infinity, 0, -1, 100, 101, '', 'a', true, {}, [], [1]]
      let checked = 0
      const check = (value: unknown): void => {
        checked++
        expect(guard(value), `disagreement on ${JSON.stringify(value)}`).toBe(validate(value) === true)
      }
      check(valid)
      for (const e of edges) check(e)
      for (const key of Object.keys(valid)) {
        for (const e of edges) check({ ...valid, [key]: e })
        const { [key]: _omit, ...without } = valid as Record<string, unknown>
        check(without)
      }
      check({ ...valid, EXTRA: 1 })
      check({ ...valid, meta: { k: 'v', EXTRA: 1 } })
      expect(checked).toBeGreaterThan(100)
    })
  })

  describe('guard soundness, fuzzed (isX never disagrees with validateX)', () => {
    /** Compiles `validateX` + `isX` together so the fuzz can assert the flat guard's
     * verdict matches the error-collecting validator on every input. */
    const evalBoth = (
      schema: Parameters<typeof generateValidatorFunction>[0],
      typeName: string,
    ): { validate: (i: unknown) => unknown; guard: (i: unknown) => boolean } => {
      const code = `${generateValidatorFunction(schema, typeName)}\n\n${generateBooleanGuard(schema, typeName)}`
      const js = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText
      const m: Record<string, unknown> = {}
      new Function('exports', js)(m)
      return {
        validate: m[`validate${typeName}`] as (i: unknown) => unknown,
        guard: m[`is${typeName}`] as (i: unknown) => boolean,
      }
    }

    /** Deterministic PRNG so a failure reproduces from the seed in the message. */
    const mulberry32 = (seed: number): (() => number) => {
      let a = seed
      return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const SCALARS: readonly unknown[] = [
      0,
      1,
      -1,
      1.5,
      NaN,
      Infinity,
      '',
      'a',
      'xy',
      'on',
      'off',
      'paid',
      '12345',
      true,
      false,
      null,
      undefined,
      {},
      [],
      [1],
    ]
    const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T

    const randomValue = (rng: () => number, depth: number): unknown => {
      if (depth > 2 || rng() < 0.7) return pick(rng, SCALARS)
      if (rng() < 0.5) {
        const arr = Array.from({ length: Math.floor(rng() * 4) }, () => randomValue(rng, depth + 1))
        // Punch a hole sometimes so sparse arrays (which `.every` skips but the
        // slow path's `for` loop rejects) are part of the search space.
        if (arr.length > 0 && rng() < 0.3) delete arr[Math.floor(rng() * arr.length)]
        return arr
      }
      const obj: Record<string, unknown> = {}
      for (const key of ['id', 'name', 'age', 'k', 'foo', 'extra', 'status']) {
        if (rng() < 0.5) obj[key] = randomValue(rng, depth + 1)
      }
      return obj
    }

    const mutate = (rng: () => number, base: unknown): unknown => {
      const value = structuredClone(base)
      if (value === null || typeof value !== 'object') return rng() < 0.5 ? randomValue(rng, 0) : value
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
      const op = rng()
      if (op < 0.3 && keys.length > 0) obj[pick(rng, keys)] = randomValue(rng, 0)
      else if (op < 0.5 && keys.length > 0) delete obj[pick(rng, keys)]
      else if (op < 0.7) obj[`x${Math.floor(rng() * 3)}`] = randomValue(rng, 0)
      else if (op < 0.85 && keys.length > 0) obj[pick(rng, keys)] = mutate(rng, obj[pick(rng, keys)])
      else if (Array.isArray(value) && value.length > 0) delete value[0] // force a sparse array
      return value
    }

    // The moltar-benchmark shapes plus an optional/array-heavy object — the schemas
    // the rich `isX` guard now covers via constrained scalars, enums and arrays.
    const cases: ReadonlyArray<{
      name: string
      schema: Parameters<typeof generateValidatorFunction>[0]
      valid: unknown
    }> = [
      {
        name: 'small',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            name: { type: 'string', minLength: 1, maxLength: 80 },
            age: { type: 'integer', minimum: 0, maximum: 130 },
            active: { type: 'boolean' },
          },
          required: ['id', 'name', 'age'],
        },
        valid: { id: 'u1', name: 'Ada', age: 36, active: true },
      },
      {
        name: 'order',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            status: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
            total: { type: 'number', minimum: 0 },
            customer: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string', minLength: 1 } },
              required: ['name', 'email'],
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'status', 'total', 'customer', 'tags'],
        },
        valid: {
          id: 'o1',
          status: 'paid',
          total: 59.97,
          customer: { name: 'Ada', email: 'ada@example.com' },
          tags: ['vip'],
        },
      },
      {
        name: 'enum-and-array',
        schema: {
          type: 'object',
          properties: {
            kind: { enum: ['a', 'b', 3, true] },
            nums: { type: 'array', items: { type: 'number' } },
          },
          required: ['kind'],
        },
        valid: { kind: 'a', nums: [1, 2, 3] },
      },
    ]

    const verdictsEqual = (a: unknown, b: boolean): boolean => (a === true) === b

    it.each(cases)('$name: isX matches validateX on thousands of random + sparse inputs', ({ schema, valid, name }) => {
      const { validate, guard } = evalBoth(schema, 'T')
      expect(validate(valid), `${name} valid`).toBe(true)
      expect(guard(valid), `${name} valid guard`).toBe(true)

      const seed = 0xbeef ^ name.length
      const rng = mulberry32(seed)
      const mismatches: string[] = []
      for (let i = 0; i < 4000; i++) {
        const input = rng() < 0.6 ? mutate(rng, valid) : randomValue(rng, 0)
        // The flat guard must return `true` only when the error-collecting
        // validator also accepts — never weakening a verdict (the core soundness
        // property, exercised here over sparse arrays, enums and constraints).
        if (!verdictsEqual(validate(input), guard(input))) {
          mismatches.push(
            `${JSON.stringify(input)} → validate=${JSON.stringify(validate(input))} guard=${guard(input)}`,
          )
        }
      }
      expect(mismatches, `seed 0x${seed.toString(16)}`).toEqual([])
    })
  })
})
