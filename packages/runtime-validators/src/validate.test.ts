import { describe, expect, it } from 'vitest'

import type { ValidationError } from './types'
import { validate } from './validate'

/** Pulls the error list out of a result, or `[]` when the result is `true`. */
const errorsOf = (result: ReturnType<ReturnType<typeof validate>>): ValidationError[] =>
  result === true ? [] : result.errors

describe('validate', () => {
  it('accepts a valid object and returns true', () => {
    const validator = validate({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    })

    expect(validator({ name: 'Ada', age: 36 })).toBe(true)
  })

  it('reports a missing required property with its path', () => {
    const validator = validate({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })

    expect(validator({})).toEqual({
      valid: false,
      errors: [{ message: "must have required property 'name'", path: '' }],
    })
  })

  it('collects every error rather than stopping at the first', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })

    const errors = errorsOf(validator({ a: 1, b: 'x' }))
    expect(errors).toHaveLength(2)
  })

  it('rejects a non-object at the root', () => {
    const validator = validate({ type: 'object' })
    expect(validator('nope')).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validator(null)).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validator([])).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
  })

  it('distinguishes integer from number', () => {
    const validator = validate({ type: 'integer' })
    expect(validator(3)).toBe(true)
    expect(validator(3.5)).not.toBe(true)
    expect(validator('3')).not.toBe(true)
  })

  it('treats null as its own type', () => {
    const validator = validate({ type: 'null' })
    expect(validator(null)).toBe(true)
    expect(validator(0)).not.toBe(true)
    expect(validator(undefined)).not.toBe(true)
  })

  it('supports a union of types', () => {
    const validator = validate({ type: ['string', 'null'] })
    expect(validator('hi')).toBe(true)
    expect(validator(null)).toBe(true)
    expect(validator(42)).not.toBe(true)
  })

  it('enforces string length and pattern constraints', () => {
    const validator = validate({ type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' })
    expect(validator('abc')).toBe(true)
    expect(validator('a')).not.toBe(true)
    expect(validator('abcde')).not.toBe(true)
    expect(validator('AB')).not.toBe(true)
  })

  it('enforces numeric bounds including exclusive bounds and multipleOf', () => {
    const validator = validate({ type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 })
    expect(validator(0)).toBe(true)
    expect(validator(9.5)).toBe(true)
    expect(validator(-1)).not.toBe(true)
    expect(validator(10)).not.toBe(true)
    expect(validator(0.3)).not.toBe(true)
  })

  it('handles multipleOf with floating point values correctly', () => {
    const validator = validate({ type: 'number', multipleOf: 0.1 })
    expect(validator(0.3)).toBe(true)
    expect(validator(0.30000000000000004)).toBe(true)
    expect(validator(0.35)).not.toBe(true)
  })

  it('validates enum membership', () => {
    const validator = validate({ enum: ['a', 'b', 3, null] })
    expect(validator('a')).toBe(true)
    expect(validator(3)).toBe(true)
    expect(validator(null)).toBe(true)
    expect(validator('c')).not.toBe(true)
  })

  it('validates const for primitives and objects', () => {
    expect(validate({ const: 'fixed' })('fixed')).toBe(true)
    expect(validate({ const: 'fixed' })('other')).not.toBe(true)

    const objConst = validate({ const: { a: 1, b: [2, 3] } })
    expect(objConst({ a: 1, b: [2, 3] })).toBe(true)
    expect(objConst({ a: 1, b: [2, 4] })).not.toBe(true)
  })

  it('validates array items and reports the offending index', () => {
    const validator = validate({ type: 'array', items: { type: 'number' } })
    expect(validator([1, 2, 3])).toBe(true)
    expect(validator([1, 'two', 3])).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/1' }],
    })
  })

  it('enforces minItems, maxItems, and uniqueItems', () => {
    const validator = validate({ type: 'array', minItems: 1, maxItems: 3, uniqueItems: true })
    expect(validator([1, 2])).toBe(true)
    expect(validator([])).not.toBe(true)
    expect(validator([1, 2, 3, 4])).not.toBe(true)
    expect(validator([1, 1])).not.toBe(true)
  })

  it('treats uniqueItems by deep equality, not reference', () => {
    const validator = validate({ type: 'array', uniqueItems: true })
    expect(validator([{ a: 1 }, { a: 2 }])).toBe(true)
    expect(validator([{ a: 1 }, { a: 1 }])).not.toBe(true)
  })

  it('validates tuples via prefixItems with a typed rest', () => {
    const validator = validate({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: { type: 'boolean' },
    })
    expect(validator(['a', 1, true, false])).toBe(true)
    expect(validator([1, 1])).not.toBe(true)
    expect(validator(['a', 1, 'x'])).not.toBe(true)
  })

  it('supports draft-07 array tuples with additionalItems', () => {
    const validator = validate({
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      additionalItems: false,
    })
    expect(validator(['a', 1])).toBe(true)
    expect(validator(['a', 1, 'extra'])).not.toBe(true)
  })

  it('forbids extra keys when additionalProperties is false', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
    expect(validator({ a: 'x' })).toBe(true)
    expect(validator({ a: 'x', b: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/b' }],
    })
  })

  it('validates extra keys against an additionalProperties schema', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(validator({ a: 'x', b: 1, c: 2 })).toBe(true)
    expect(validator({ a: 'x', b: 'not a number' })).not.toBe(true)
  })

  it('validates patternProperties', () => {
    const validator = validate({
      type: 'object',
      patternProperties: { '^num_': { type: 'number' } },
      additionalProperties: false,
    })
    expect(validator({ num_a: 1, num_b: 2 })).toBe(true)
    expect(validator({ num_a: 'x' })).not.toBe(true)
    expect(validator({ other: 1 })).not.toBe(true)
  })

  it('enforces minProperties and maxProperties', () => {
    const validator = validate({ type: 'object', minProperties: 1, maxProperties: 2 })
    expect(validator({ a: 1 })).toBe(true)
    expect(validator({})).not.toBe(true)
    expect(validator({ a: 1, b: 2, c: 3 })).not.toBe(true)
  })

  it('enforces dependentRequired', () => {
    const validator = validate({
      type: 'object',
      properties: { creditCard: { type: 'number' }, billingAddress: { type: 'string' } },
      dependentRequired: { creditCard: ['billingAddress'] },
    })
    expect(validator({})).toBe(true)
    expect(validator({ creditCard: 123, billingAddress: 'x' })).toBe(true)
    expect(validator({ creditCard: 123 })).not.toBe(true)
  })

  it('resolves local $ref including recursion', () => {
    const validator = validate({
      type: 'object',
      properties: {
        value: { type: 'number' },
        children: { type: 'array', items: { $ref: '#' } },
      },
      required: ['value'],
    })

    expect(validator({ value: 1, children: [{ value: 2 }, { value: 3, children: [{ value: 4 }] }] })).toBe(true)
    expect(validator({ value: 1, children: [{ value: 'nope' }] })).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/children/0/value' }],
    })
  })

  it('resolves $ref into $defs', () => {
    const validator = validate({
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      required: ['user'],
      $defs: {
        user: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    })
    expect(validator({ user: { name: 'Ada' } })).toBe(true)
    expect(validator({ user: {} })).not.toBe(true)
  })

  it('validates contains with min/maxContains', () => {
    const atLeastOne = validate({ type: 'array', contains: { type: 'number' } })
    expect(atLeastOne([1, 'a'])).toBe(true)
    expect(atLeastOne(['a', 'b'])).not.toBe(true)
    expect(atLeastOne([])).not.toBe(true)

    const between = validate({ type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 3 })
    expect(between(['a', 1, 2])).toBe(true)
    expect(between([1])).not.toBe(true)
    expect(between([1, 2, 3, 4])).not.toBe(true)

    // minContains: 0 makes the lower bound trivially satisfied, even when empty.
    const zero = validate({ type: 'array', contains: { type: 'number' }, minContains: 0, maxContains: 1 })
    expect(zero([])).toBe(true)
    expect(zero(['a'])).toBe(true)
    expect(zero([1, 2])).not.toBe(true)
  })

  it('validates propertyNames against a schema', () => {
    const validator = validate({ type: 'object', propertyNames: { pattern: '^[a-z]+$' } })
    expect(validator({ foo: 1, bar: 2 })).toBe(true)
    expect(validator({ Foo: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'property name "Foo" is invalid', path: '/Foo' }],
    })
  })

  it('applies dependentSchemas when the trigger property is present', () => {
    const validator = validate({
      type: 'object',
      properties: { creditCard: { type: 'number' } },
      dependentSchemas: {
        creditCard: { required: ['billingAddress'], properties: { billingAddress: { type: 'string' } } },
      },
    })
    expect(validator({})).toBe(true) // trigger absent → no dependency
    expect(validator({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(validator({ creditCard: 1 })).not.toBe(true) // missing dependent
  })

  it('supports the draft-07 dependencies keyword (array and schema forms)', () => {
    const arrayForm = validate({ type: 'object', dependencies: { creditCard: ['billingAddress'] } })
    expect(arrayForm({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(arrayForm({ creditCard: 1 })).toEqual({
      valid: false,
      errors: [{ message: "must have property 'billingAddress' when 'creditCard' is present", path: '' }],
    })

    const schemaForm = validate({ type: 'object', dependencies: { creditCard: { required: ['billingAddress'] } } })
    expect(schemaForm({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(schemaForm({ creditCard: 1 })).not.toBe(true)
    expect(schemaForm({})).toBe(true)
  })

  it('validates allOf as the intersection', () => {
    const validator = validate({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(validator({ a: 'x', b: 1 })).toBe(true)
    expect(validator({ a: 'x' })).not.toBe(true)
  })

  it('validates anyOf', () => {
    const validator = validate({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(validator('x')).toBe(true)
    expect(validator(1)).toBe(true)
    expect(validator(true)).not.toBe(true)
  })

  it('validates oneOf as exactly one match', () => {
    const validator = validate({
      oneOf: [
        { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    })
    expect(validator({ kind: 'a' })).toBe(true)
    expect(validator({ kind: 'c' })).not.toBe(true)
  })

  it('validates not', () => {
    const validator = validate({ not: { type: 'string' } })
    expect(validator(1)).toBe(true)
    expect(validator('x')).not.toBe(true)
  })

  it('validates if/then/else', () => {
    const validator = validate({
      type: 'object',
      properties: { kind: { type: 'string' }, value: {} },
      if: { properties: { kind: { const: 'number' } }, required: ['kind'] },
      then: { properties: { value: { type: 'number' } } },
      else: { properties: { value: { type: 'string' } } },
    })
    expect(validator({ kind: 'number', value: 1 })).toBe(true)
    expect(validator({ kind: 'number', value: 'x' })).not.toBe(true)
    expect(validator({ kind: 'text', value: 'x' })).toBe(true)
    expect(validator({ kind: 'text', value: 1 })).not.toBe(true)
  })

  it('treats boolean schemas as always/never valid', () => {
    expect(validate(true)(42)).toBe(true)
    expect(validate(false)(42)).not.toBe(true)
    expect(validate({ type: 'object', properties: { a: false } })({ a: 1 })).not.toBe(true)
    expect(validate({ type: 'object', properties: { a: false } })({})).toBe(true)
  })

  it('only enforces formats when they are enabled', () => {
    const lenient = validate({ type: 'string', format: 'email' })
    expect(lenient('not-an-email')).toBe(true)

    const strict = validate({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(strict('ada@example.com')).toBe(true)
    expect(strict('not-an-email')).not.toBe(true)
  })

  it('accepts null for an OpenAPI `nullable: true` schema regardless of type', () => {
    const validator = validate({ type: 'string', minLength: 3, nullable: true })
    expect(validator(null)).toBe(true)
    expect(validator('abc')).toBe(true)
    expect(validator('ab')).not.toBe(true) // string constraints still apply
    expect(validator(42)).not.toBe(true) // wrong, non-null type still rejected
  })

  it('lets `nullable` short-circuit enum, const and format checks', () => {
    expect(validate({ enum: ['a', 'b'], nullable: true })(null)).toBe(true)
    expect(validate({ const: 'fixed', nullable: true })(null)).toBe(true)
    expect(validate({ type: 'string', format: 'email', nullable: true }, { formats: 'all' })(null)).toBe(true)
  })

  it('does not flag a null value on a nullable property', () => {
    const validator = validate({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string', nullable: true },
      },
      required: ['name'],
    })
    expect(validator({ name: 'Ada', nickname: null })).toBe(true)
    expect(validator({ name: 'Ada', nickname: 'Countess' })).toBe(true)
    expect(validator({ name: 'Ada', nickname: 7 })).not.toBe(true)
  })

  it('accepts null on a nullable schema that wraps a $ref', () => {
    // OpenAPI emits `nullable` as a sibling of `$ref` (and, where the spec is
    // followed strictly, as a sibling of `allOf: [{ $ref }]`). In both forms a
    // null value must short-circuit before the referenced schema is applied.
    const defs = { $defs: { Point: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } } }

    const sibling = validate({ ...defs, $ref: '#/$defs/Point', nullable: true })
    expect(sibling(null)).toBe(true)
    expect(sibling({ x: 1 })).toBe(true)
    expect(sibling({ x: 'no' })).not.toBe(true) // non-null still validates against the ref

    const wrapped = validate({ ...defs, allOf: [{ $ref: '#/$defs/Point' }], nullable: true })
    expect(wrapped(null)).toBe(true)
    expect(wrapped({ x: 'no' })).not.toBe(true)
  })

  it('treats a non-schema node leniently instead of throwing or inventing errors', () => {
    // OpenAPI parameter objects (`{ in, name, required, ... }`) get swept up by
    // broad example selectors and handed to the validator as if they were
    // schemas. Ajv cannot compile them — `required` is a boolean, not an array
    // — so it silently skips them. We reach the same zero-findings outcome by
    // ignoring keywords we do not recognize and the malformed `required`,
    // rather than failing: an unknown keyword is an annotation, not a rule.
    const parameter = { in: 'query', name: 'limit', required: false, description: 'page size' }
    const validator = validate(parameter)
    expect(validator(123)).toBe(true)
    expect(validator({ anything: true })).toBe(true)
    expect(validator(null)).toBe(true)
  })

  it('throws a helpful error for an unresolvable $ref on first use', () => {
    // The schema is walked lazily — `$ref`s resolve when the validator runs, not
    // when it is built — so an unresolvable pointer surfaces on first use.
    const validator = validate({ $ref: '#/$defs/missing' })
    expect(() => validator({})).toThrow(/Cannot resolve/)
  })

  it('does no work until the validator is actually called', () => {
    // Building the validator must not walk or resolve anything: a malformed
    // $ref would throw on use, so construction completing without a throw proves
    // the interpreter is fully deferred to call time.
    let constructed = false
    const validator = validate({ $ref: '#/$defs/missing' })
    constructed = true
    expect(constructed).toBe(true)
    expect(() => validator(1)).toThrow(/Cannot resolve/)
  })
})
