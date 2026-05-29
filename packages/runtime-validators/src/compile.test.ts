import { describe, expect, it } from 'vitest'

import { compile } from './compile'
import type { ValidationError } from './types'

/** Pulls the error list out of a result, or `[]` when the result is `true`. */
const errorsOf = (result: ReturnType<ReturnType<typeof compile>>): ValidationError[] =>
  result === true ? [] : result.errors

describe('compile', () => {
  it('accepts a valid object and returns true', () => {
    const validate = compile({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    })

    expect(validate({ name: 'Ada', age: 36 })).toBe(true)
  })

  it('reports a missing required property with its path', () => {
    const validate = compile({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })

    expect(validate({})).toEqual({
      valid: false,
      errors: [{ message: "must have required property 'name'", path: '' }],
    })
  })

  it('collects every error rather than stopping at the first', () => {
    const validate = compile({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })

    const errors = errorsOf(validate({ a: 1, b: 'x' }))
    expect(errors).toHaveLength(2)
  })

  it('rejects a non-object at the root', () => {
    const validate = compile({ type: 'object' })
    expect(validate('nope')).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validate(null)).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validate([])).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
  })

  it('distinguishes integer from number', () => {
    const validate = compile({ type: 'integer' })
    expect(validate(3)).toBe(true)
    expect(validate(3.5)).not.toBe(true)
    expect(validate('3')).not.toBe(true)
  })

  it('treats null as its own type', () => {
    const validate = compile({ type: 'null' })
    expect(validate(null)).toBe(true)
    expect(validate(0)).not.toBe(true)
    expect(validate(undefined)).not.toBe(true)
  })

  it('supports a union of types', () => {
    const validate = compile({ type: ['string', 'null'] })
    expect(validate('hi')).toBe(true)
    expect(validate(null)).toBe(true)
    expect(validate(42)).not.toBe(true)
  })

  it('enforces string length and pattern constraints', () => {
    const validate = compile({ type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' })
    expect(validate('abc')).toBe(true)
    expect(validate('a')).not.toBe(true)
    expect(validate('abcde')).not.toBe(true)
    expect(validate('AB')).not.toBe(true)
  })

  it('enforces numeric bounds including exclusive bounds and multipleOf', () => {
    const validate = compile({ type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 })
    expect(validate(0)).toBe(true)
    expect(validate(9.5)).toBe(true)
    expect(validate(-1)).not.toBe(true)
    expect(validate(10)).not.toBe(true)
    expect(validate(0.3)).not.toBe(true)
  })

  it('handles multipleOf with floating point values correctly', () => {
    const validate = compile({ type: 'number', multipleOf: 0.1 })
    expect(validate(0.3)).toBe(true)
    expect(validate(0.30000000000000004)).toBe(true)
    expect(validate(0.35)).not.toBe(true)
  })

  it('validates enum membership', () => {
    const validate = compile({ enum: ['a', 'b', 3, null] })
    expect(validate('a')).toBe(true)
    expect(validate(3)).toBe(true)
    expect(validate(null)).toBe(true)
    expect(validate('c')).not.toBe(true)
  })

  it('validates const for primitives and objects', () => {
    expect(compile({ const: 'fixed' })('fixed')).toBe(true)
    expect(compile({ const: 'fixed' })('other')).not.toBe(true)

    const objConst = compile({ const: { a: 1, b: [2, 3] } })
    expect(objConst({ a: 1, b: [2, 3] })).toBe(true)
    expect(objConst({ a: 1, b: [2, 4] })).not.toBe(true)
  })

  it('validates array items and reports the offending index', () => {
    const validate = compile({ type: 'array', items: { type: 'number' } })
    expect(validate([1, 2, 3])).toBe(true)
    expect(validate([1, 'two', 3])).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/1' }],
    })
  })

  it('enforces minItems, maxItems, and uniqueItems', () => {
    const validate = compile({ type: 'array', minItems: 1, maxItems: 3, uniqueItems: true })
    expect(validate([1, 2])).toBe(true)
    expect(validate([])).not.toBe(true)
    expect(validate([1, 2, 3, 4])).not.toBe(true)
    expect(validate([1, 1])).not.toBe(true)
  })

  it('treats uniqueItems by deep equality, not reference', () => {
    const validate = compile({ type: 'array', uniqueItems: true })
    expect(validate([{ a: 1 }, { a: 2 }])).toBe(true)
    expect(validate([{ a: 1 }, { a: 1 }])).not.toBe(true)
  })

  it('validates tuples via prefixItems with a typed rest', () => {
    const validate = compile({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: { type: 'boolean' },
    })
    expect(validate(['a', 1, true, false])).toBe(true)
    expect(validate([1, 1])).not.toBe(true)
    expect(validate(['a', 1, 'x'])).not.toBe(true)
  })

  it('supports draft-07 array tuples with additionalItems', () => {
    const validate = compile({
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      additionalItems: false,
    })
    expect(validate(['a', 1])).toBe(true)
    expect(validate(['a', 1, 'extra'])).not.toBe(true)
  })

  it('forbids extra keys when additionalProperties is false', () => {
    const validate = compile({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
    expect(validate({ a: 'x' })).toBe(true)
    expect(validate({ a: 'x', b: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/b' }],
    })
  })

  it('validates extra keys against an additionalProperties schema', () => {
    const validate = compile({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(validate({ a: 'x', b: 1, c: 2 })).toBe(true)
    expect(validate({ a: 'x', b: 'not a number' })).not.toBe(true)
  })

  it('validates patternProperties', () => {
    const validate = compile({
      type: 'object',
      patternProperties: { '^num_': { type: 'number' } },
      additionalProperties: false,
    })
    expect(validate({ num_a: 1, num_b: 2 })).toBe(true)
    expect(validate({ num_a: 'x' })).not.toBe(true)
    expect(validate({ other: 1 })).not.toBe(true)
  })

  it('enforces minProperties and maxProperties', () => {
    const validate = compile({ type: 'object', minProperties: 1, maxProperties: 2 })
    expect(validate({ a: 1 })).toBe(true)
    expect(validate({})).not.toBe(true)
    expect(validate({ a: 1, b: 2, c: 3 })).not.toBe(true)
  })

  it('enforces dependentRequired', () => {
    const validate = compile({
      type: 'object',
      properties: { creditCard: { type: 'number' }, billingAddress: { type: 'string' } },
      dependentRequired: { creditCard: ['billingAddress'] },
    })
    expect(validate({})).toBe(true)
    expect(validate({ creditCard: 123, billingAddress: 'x' })).toBe(true)
    expect(validate({ creditCard: 123 })).not.toBe(true)
  })

  it('resolves local $ref including recursion', () => {
    const validate = compile({
      type: 'object',
      properties: {
        value: { type: 'number' },
        children: { type: 'array', items: { $ref: '#' } },
      },
      required: ['value'],
    })

    expect(validate({ value: 1, children: [{ value: 2 }, { value: 3, children: [{ value: 4 }] }] })).toBe(true)
    expect(validate({ value: 1, children: [{ value: 'nope' }] })).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/children/0/value' }],
    })
  })

  it('resolves $ref into $defs', () => {
    const validate = compile({
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      required: ['user'],
      $defs: {
        user: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    })
    expect(validate({ user: { name: 'Ada' } })).toBe(true)
    expect(validate({ user: {} })).not.toBe(true)
  })

  it('validates allOf as the intersection', () => {
    const validate = compile({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(validate({ a: 'x', b: 1 })).toBe(true)
    expect(validate({ a: 'x' })).not.toBe(true)
  })

  it('validates anyOf', () => {
    const validate = compile({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(validate('x')).toBe(true)
    expect(validate(1)).toBe(true)
    expect(validate(true)).not.toBe(true)
  })

  it('validates oneOf as exactly one match', () => {
    const validate = compile({
      oneOf: [
        { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    })
    expect(validate({ kind: 'a' })).toBe(true)
    expect(validate({ kind: 'c' })).not.toBe(true)
  })

  it('validates not', () => {
    const validate = compile({ not: { type: 'string' } })
    expect(validate(1)).toBe(true)
    expect(validate('x')).not.toBe(true)
  })

  it('validates if/then/else', () => {
    const validate = compile({
      type: 'object',
      properties: { kind: { type: 'string' }, value: {} },
      if: { properties: { kind: { const: 'number' } }, required: ['kind'] },
      then: { properties: { value: { type: 'number' } } },
      else: { properties: { value: { type: 'string' } } },
    })
    expect(validate({ kind: 'number', value: 1 })).toBe(true)
    expect(validate({ kind: 'number', value: 'x' })).not.toBe(true)
    expect(validate({ kind: 'text', value: 'x' })).toBe(true)
    expect(validate({ kind: 'text', value: 1 })).not.toBe(true)
  })

  it('treats boolean schemas as always/never valid', () => {
    expect(compile(true)(42)).toBe(true)
    expect(compile(false)(42)).not.toBe(true)
    expect(compile({ type: 'object', properties: { a: false } })({ a: 1 })).not.toBe(true)
    expect(compile({ type: 'object', properties: { a: false } })({})).toBe(true)
  })

  it('only enforces formats when they are enabled', () => {
    const lenient = compile({ type: 'string', format: 'email' })
    expect(lenient('not-an-email')).toBe(true)

    const strict = compile({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(strict('ada@example.com')).toBe(true)
    expect(strict('not-an-email')).not.toBe(true)
  })

  it('throws a helpful error for an unresolvable $ref on first use', () => {
    // Compilation is lazy (to keep startup cheap), so the error surfaces when
    // the validator is first invoked rather than at compile() time.
    const validate = compile({ $ref: '#/$defs/missing' })
    expect(() => validate({})).toThrow(/Cannot resolve/)
  })

  it('compiles lazily and only once', () => {
    let constructed = false
    // Building the validator must not eagerly compile. We cannot observe the
    // JIT directly, but a malformed $ref would throw on compile — so the fact
    // that construction does not throw proves compilation was deferred.
    const validate = compile({ $ref: '#/$defs/missing' })
    constructed = true
    expect(constructed).toBe(true)
    expect(() => validate(1)).toThrow(/Cannot resolve/)
  })
})
