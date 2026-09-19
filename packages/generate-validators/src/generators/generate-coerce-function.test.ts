import { describe, expect, it } from 'vitest'

import { evaluateGenerated } from './evaluate-generated.test-utils'
import { generateCoerceFunction } from './generate-coerce-function'
import { generateValidatorFunction } from './generate-validator-function'

type Coerced = { valid: true; value: unknown } | { valid: false; errors: { path: string; keyword: string }[] }

/** The validator and its coercing half, compiled together as a file carries them. */
const compile = (schema: Record<string, unknown>): ((input: unknown) => Coerced) => {
  const code =
    generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code
  return evaluateGenerated(code)['coerceRoot'] as (input: unknown) => Coerced
}

describe('generate-coerce-function', () => {
  it('coerces a scalar property toward the type the schema declares', () => {
    const coerce = compile({
      type: 'object',
      properties: { flag: { type: 'boolean' }, count: { type: 'integer' }, name: { type: 'string' } },
    })

    expect(coerce({ flag: 'true', count: '3', name: 7 })).toEqual({
      valid: true,
      value: { flag: true, count: 3, name: '7' },
    })
  })

  // The whole reason this is not a parser. A repairing parser turns `"many"`
  // into `0` and reports nothing, which for config validation is worse than
  // useless — it swallows the mistake. Here the value that cannot be coerced
  // reaches the validator untouched, so the error names what the caller wrote.
  it('reports the original error when a value cannot be coerced', () => {
    const coerce = compile({ type: 'object', properties: { count: { type: 'integer' } } })

    expect(coerce({ count: 'many' })).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/count', keyword: 'type', params: { type: 'integer' } }],
    })
  })

  it('applies the constraint keywords to the coerced value, not the original', () => {
    const coerce = compile({ type: 'object', properties: { count: { type: 'integer', minimum: 5 } } })

    // `"3"` is a valid integer once coerced and only then fails `minimum` — an
    // answer neither "reject the string" nor "repair to something valid" gives.
    expect(coerce({ count: '3' })).toEqual({
      valid: false,
      errors: [{ message: 'must be >= 5', path: '/count', keyword: 'minimum', params: { comparison: '>=', limit: 5 } }],
    })
    expect(coerce({ count: '7' })).toEqual({ valid: true, value: { count: 7 } })
  })

  it('never modifies the input', () => {
    const coerce = compile({ type: 'object', properties: { flag: { type: 'boolean' } } })
    const input = { flag: 'true' }

    const result = coerce(input)

    expect(result).toEqual({ valid: true, value: { flag: true } })
    expect(input).toEqual({ flag: 'true' })
  })

  // What lets a caller skip the defensive clone Ajv's in-place coercion forces.
  it('returns the input by reference when nothing needed coercing', () => {
    const coerce = compile({
      type: 'object',
      properties: { inner: { type: 'object', properties: { flag: { type: 'boolean' } } } },
    })
    const input = { inner: { flag: true } }

    const result = coerce(input)

    expect(result.valid && result.value).toBe(input)
  })

  it('shares the parts it did not touch with the input', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        touched: { type: 'object', properties: { n: { type: 'integer' } } },
        untouched: { type: 'object', properties: { n: { type: 'integer' } } },
      },
    })
    const untouched = { n: 1 }
    const input = { touched: { n: '2' }, untouched }

    const result = coerce(input)

    expect(result.valid && result.value).not.toBe(input)
    expect(result.valid && (result.value as { untouched: unknown }).untouched).toBe(untouched)
  })

  it('coerces through arrays, tuple positions and nested objects', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'number' } },
        pair: { type: 'array', prefixItems: [{ type: 'boolean' }, { type: 'integer' }], items: { type: 'string' } },
        deep: { type: 'object', properties: { inner: { type: 'object', properties: { n: { type: 'integer' } } } } },
      },
    })

    expect(coerce({ list: ['1', 2], pair: ['true', '2', 3], deep: { inner: { n: '4' } } })).toEqual({
      valid: true,
      value: { list: [1, 2], pair: [true, 2, '3'], deep: { inner: { n: 4 } } },
    })
  })

  it('coerces the keys patternProperties and additionalProperties reach', () => {
    const coerce = compile({
      type: 'object',
      properties: { known: { type: 'integer' } },
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: { type: 'boolean' },
    })

    expect(coerce({ known: '1', 'x-a': 2, other: 'true' })).toEqual({
      valid: true,
      value: { known: 1, 'x-a': '2', other: true },
    })
  })

  // A union says more than one thing about the value, and coercing toward one of
  // them would be inventing an answer the schema does not give. Ajv picks by the
  // order of its own coercion list, which silently makes `"1"` a number under
  // `['number', 'string']` and leaves it a string under `['string', 'number']`.
  it('leaves a position the schema is ambiguous about alone', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        union: { type: ['number', 'string'] },
        branch: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      },
    })

    expect(coerce({ union: '1', branch: '2' })).toEqual({ valid: true, value: { union: '1', branch: '2' } })
  })

  it('emits no walk at all for a schema with nothing to coerce', () => {
    const { code } = generateCoerceFunction({ type: 'object', properties: { a: { enum: ['x'] } } } as never, 'Root')

    // The identity case is emitted as the identity, so a schema that coerces
    // nothing pays nothing and hands every value straight back.
    expect(code).toContain('export const coerceRootValue = (input: unknown): unknown => input')
    expect(code).not.toContain('coerceScalar(')
  })

  it('names the referenced file’s walk for a $ref position', () => {
    const { code } = generateCoerceFunction(
      { type: 'object', properties: { retry: { $ref: '#/$defs/retryConfig' } } } as never,
      'Root',
    )

    // A coercion has to cross a file boundary the same way validation does.
    expect(code).toContain('coerceRetryConfigValue(')
  })

  it('applies the type suffix to a $ref walk name', () => {
    const { code } = generateCoerceFunction(
      { type: 'object', properties: { retry: { $ref: '#/$defs/retry' } } } as never,
      'Root',
      'Object',
    )

    expect(code).toContain('coerceRetryObjectValue(')
  })

  // This pass *writes*, which makes a prototype read worse here than elsewhere:
  // an inherited key that gets coerced is written onto the copy as the object's
  // own, inventing data the caller never sent. (What the validator then makes of
  // a polluted prototype is its own contract, pinned in `polluted-prototype`; the
  // walk is asserted on directly so this test is about the walk.)
  it('reads keys as own properties, not through the prototype', () => {
    const code =
      generateValidatorFunction({ type: 'object', properties: { flag: { type: 'boolean' } } } as never, 'Root') +
      '\n\n' +
      generateCoerceFunction({ type: 'object', properties: { flag: { type: 'boolean' } } } as never, 'Root').code
    const walk = evaluateGenerated(code)['coerceRootValue'] as (input: unknown) => unknown

    const polluted = Object.prototype as Record<string, unknown>
    try {
      polluted['flag'] = 'true'
      const input = {}

      expect(walk(input)).toBe(input)
      expect(Object.hasOwn(walk(input) as object, 'flag')).toBe(false)
    } finally {
      delete polluted['flag']
    }
  })

  it('does not turn an array hole into an element', () => {
    const schema = { type: 'array', items: { type: 'boolean' } }
    const code =
      generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code
    const walk = evaluateGenerated(code)['coerceRootValue'] as (input: unknown) => unknown

    const polluted = Array.prototype as unknown as Record<number, unknown>
    try {
      polluted[0] = 'true'
      const input: unknown[] = new Array(2)
      input[1] = true

      expect(Object.hasOwn(walk(input) as object, 0)).toBe(false)
    } finally {
      delete polluted[0]
    }
  })
})
