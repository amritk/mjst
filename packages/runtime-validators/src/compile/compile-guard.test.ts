import { describe, expect, it } from 'vitest'
import { isValidationLimitError } from '@/interpreter/limits'
import { validateGuard } from '@/validate-guard'

import { compileGuard } from './compile-guard'

describe('compile-guard', () => {
  it('validates a typed object', () => {
    const isUser = compileGuard({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    })
    expect(isUser({ id: 1, name: 'Ada' })).toBe(true)
    expect(isUser({ id: 'nope', name: 'Ada' })).toBe(false)
    expect(isUser({ id: 1 })).toBe(false)
  })

  it('enforces additionalProperties: false', () => {
    const guard = compileGuard({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
    expect(guard({ a: 'x' })).toBe(true)
    expect(guard({ a: 'x', b: 1 })).toBe(false)
  })

  it('enforces an additionalProperties schema', () => {
    const guard = compileGuard({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(guard({ a: 'x', b: 1 })).toBe(true)
    expect(guard({ a: 'x', b: 'y' })).toBe(false)
  })

  it('validates arrays, tuples, and the rest schema', () => {
    expect(compileGuard({ type: 'array', items: { type: 'integer' } })([1, 2])).toBe(true)
    expect(compileGuard({ type: 'array', items: { type: 'integer' } })([1, 'x'])).toBe(false)
    const tuple = compileGuard({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: { type: 'boolean' },
    })
    expect(tuple(['a', 1, true, false])).toBe(true)
    expect(tuple(['a', 1, 2])).toBe(false)
  })

  it('enforces string, numeric, and membership keywords', () => {
    expect(compileGuard({ type: 'string', minLength: 2, maxLength: 3 })('ab')).toBe(true)
    expect(compileGuard({ type: 'string', minLength: 2 })('a')).toBe(false)
    expect(compileGuard({ type: 'string', pattern: '^a+$' })('aaa')).toBe(true)
    expect(compileGuard({ type: 'string', pattern: '^a+$' })('b')).toBe(false)
    expect(compileGuard({ type: 'number', minimum: 0, maximum: 10 })(5)).toBe(true)
    expect(compileGuard({ type: 'number', minimum: 0 })(-1)).toBe(false)
    expect(compileGuard({ type: 'number', multipleOf: 0.1 })(0.3)).toBe(true)
    expect(compileGuard({ enum: ['a', 'b'] })('a')).toBe(true)
    expect(compileGuard({ enum: ['a', 'b'] })('c')).toBe(false)
    expect(compileGuard({ const: { a: 1 } })({ a: 1 })).toBe(true)
  })

  it('fails NaN against a bound, as the interpreter does', () => {
    expect(compileGuard({ type: 'number', minimum: 0 })(Number.NaN)).toBe(false)
    expect(compileGuard({ type: 'number' })(Number.NaN)).toBe(true)
  })

  it('counts string length in code points, not UTF-16 units', () => {
    // '😀' is one code point and two code units; a naive `.length` would say 2.
    expect(compileGuard({ type: 'string', maxLength: 1 })('😀')).toBe(true)
  })

  it('validates the branch keywords', () => {
    expect(compileGuard({ anyOf: [{ type: 'string' }, { type: 'number' }] })(1)).toBe(true)
    expect(compileGuard({ anyOf: [{ type: 'string' }, { type: 'number' }] })(true)).toBe(false)
    expect(compileGuard({ oneOf: [{ type: 'number' }, { type: 'integer' }] })(1.5)).toBe(true)
    // Both branches match an integer, so `oneOf` rejects it.
    expect(compileGuard({ oneOf: [{ type: 'number' }, { type: 'integer' }] })(1)).toBe(false)
    expect(compileGuard({ allOf: [{ type: 'number' }, { minimum: 0 }] })(-1)).toBe(false)
    expect(compileGuard({ not: { type: 'string' } })(1)).toBe(true)
  })

  it('resolves and links a local $ref, including a recursive one', () => {
    const guard = compileGuard({
      type: 'object',
      properties: { value: { type: 'integer' }, next: { $ref: '#' } },
      required: ['value'],
    })
    expect(guard({ value: 1, next: { value: 2 } })).toBe(true)
    expect(guard({ value: 1, next: { value: 'x' } })).toBe(false)
  })

  it('caps a recursive $ref over deep data instead of overflowing the stack', () => {
    let deep: Record<string, unknown> = { value: 1 }
    for (let i = 0; i < 300; i++) deep = { value: 1, next: deep }
    const guard = compileGuard(
      { type: 'object', properties: { value: { type: 'integer' }, next: { $ref: '#' } } },
      { limits: { maxDepth: 10 } },
    )
    try {
      guard(deep)
      throw new Error('expected a limit error')
    } catch (error) {
      expect(isValidationLimitError(error)).toBe(true)
    }
  })

  it('hands a document declaring $id to the interpreter rather than compiling it', () => {
    // Base-URI resolution is the interpreter's; the point is that the verdict is
    // still right, not that this path is fast.
    const schema = {
      $id: 'https://example.com/root.json',
      type: 'object',
      properties: { a: { $ref: '#/$defs/s' } },
      $defs: { s: { type: 'string' } },
    }
    expect(compileGuard(schema)({ a: 'x' })).toBe(true)
    expect(compileGuard(schema)({ a: 1 })).toBe(false)
  })

  it('falls back for the keywords it does not compile, keeping the verdict', () => {
    const cases: Array<[Record<string, unknown>, unknown, boolean]> = [
      [{ type: 'object', patternProperties: { '^a': { type: 'number' } } }, { ab: 'x' }, false],
      [{ if: { type: 'string' }, then: { minLength: 3 } }, 'ab', false],
      [{ type: 'array', uniqueItems: true }, [1, 1], false],
      [{ type: 'array', contains: { type: 'string' } }, [1, 2], false],
      [{ type: 'object', propertyNames: { maxLength: 1 } }, { ab: 1 }, false],
      [{ type: 'object', dependentRequired: { a: ['b'] } }, { a: 1 }, false],
      [
        { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false },
        { a: 'x', b: 1 },
        false,
      ],
    ]
    for (const [schema, value, expected] of cases) {
      expect(compileGuard(schema)(value), JSON.stringify(schema)).toBe(expected)
      // And it is the interpreter's own answer, not a coincidence.
      expect(compileGuard(schema)(value)).toBe(validateGuard(schema)(value))
    }
  })

  it('enforces formats when they are enabled', () => {
    expect(compileGuard({ type: 'string', format: 'email' }, { formats: 'all' })('nope')).toBe(false)
    expect(compileGuard({ type: 'string', format: 'email' }, { formats: 'all' })('a@b.com')).toBe(true)
    // Off by default, as everywhere else in this package.
    expect(compileGuard({ type: 'string', format: 'email' })('nope')).toBe(true)
  })

  it('throws on an unknown type keyword at compile time, not on first use', () => {
    expect(() => compileGuard({ type: 'strng' })).toThrow(/Unknown type/)
  })

  it('refuses a ReDoS-prone pattern up front, as a prepared validator does', () => {
    expect(() => compileGuard({ type: 'string', pattern: '^(a+)+$' })).toThrow()
  })

  it('resolves a $ref through a registry by deferring to the interpreter', () => {
    const guard = compileGuard(
      { $ref: 'https://example.com/user.json' },
      { schemas: { 'https://example.com/user.json': { type: 'string' } } },
    )
    expect(guard('x')).toBe(true)
    expect(guard(1)).toBe(false)
  })
})
