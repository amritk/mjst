import { describe, expect, it } from 'vitest'

import type { IFunctionContext } from '../core/types'
import { alphabetical, casing, enumeration, schema, typedEnum, xor } from './index'

const ctx = (path: (string | number)[] = []): IFunctionContext =>
  ({ path, rule: {} as never, document: { data: {} } as never }) as IFunctionContext

describe('casing', () => {
  const cases: [string, string, boolean][] = [
    ['camel', 'fooBar', true],
    ['camel', 'FooBar', false],
    ['pascal', 'FooBar', true],
    ['pascal', 'fooBar', false],
    ['kebab', 'foo-bar', true],
    ['kebab', 'foo_bar', false],
    ['snake', 'foo_bar', true],
    ['macro', 'FOO_BAR', true],
    ['cobol', 'FOO-BAR', true],
    ['flat', 'foobar', true],
    ['flat', 'fooBar', false],
  ]
  for (const [type, input, ok] of cases) {
    it(`${type}: "${input}" -> ${ok ? 'valid' : 'invalid'}`, () => {
      const results = casing(input, { type: type as never }, ctx())
      expect(results?.length === 0).toBe(ok)
    })
  }

  it('disallows digits when configured', () => {
    expect(casing('foo1', { type: 'flat' }, ctx())).toHaveLength(0)
    expect(casing('foo1', { type: 'flat', disallowDigits: true }, ctx())).toHaveLength(1)
  })
})

describe('enumeration', () => {
  it('passes allowed values and fails others', () => {
    expect(enumeration('a', { values: ['a', 'b'] }, ctx())).toHaveLength(0)
    expect(enumeration('c', { values: ['a', 'b'] }, ctx())).toHaveLength(1)
  })
})

describe('xor', () => {
  it('requires exactly one property', () => {
    expect(xor({ a: 1 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0)
    expect(xor({ a: 1, b: 2 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
    expect(xor({}, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
  })
})

describe('alphabetical', () => {
  it('flags out-of-order arrays', () => {
    expect(alphabetical(['a', 'b', 'c'], {}, ctx())).toHaveLength(0)
    expect(alphabetical(['b', 'a'], {}, ctx())).toHaveLength(1)
  })
  it('compares by keyedBy', () => {
    const value = [{ name: 'b' }, { name: 'a' }]
    expect(alphabetical(value, { keyedBy: 'name' }, ctx())).toHaveLength(1)
  })
})

describe('schema', () => {
  it('validates against a JSON schema and reports paths', () => {
    const opts = { schema: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } } }
    expect(schema({ x: 1 }, opts, ctx())).toHaveLength(0)
    const results = schema({ x: 'no' }, opts, ctx(['root']))
    expect(results).toHaveLength(1)
    expect(results?.[0]?.path).toEqual(['root', 'x'])
  })
})

describe('typedEnum', () => {
  it('flags enum values that do not match the declared type', () => {
    expect(typedEnum({ type: 'string', enum: ['a', 'b'] }, undefined as never, ctx())).toHaveLength(0)
    const results = typedEnum({ type: 'string', enum: ['a', 2] }, undefined as never, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.path).toEqual(['enum', 1])
  })

  it('honors nullable and x-nullable so a null enum entry is allowed', () => {
    expect(typedEnum({ type: 'string', nullable: true, enum: ['a', null] }, undefined as never, ctx())).toHaveLength(0)
    expect(
      typedEnum({ type: 'string', 'x-nullable': true, enum: ['a', null] }, undefined as never, ctx()),
    ).toHaveLength(0)
    // without a nullable flag, null is still a type mismatch
    expect(typedEnum({ type: 'string', enum: ['a', null] }, undefined as never, ctx())).toHaveLength(1)
  })

  it('accepts a type array where each enum entry matches one of the types', () => {
    expect(typedEnum({ type: ['string', 'number'], enum: ['a', 2] }, undefined as never, ctx())).toHaveLength(0)
    expect(typedEnum({ type: ['string', 'number'], enum: ['a', true] }, undefined as never, ctx())).toHaveLength(1)
  })

  it('skips non-object input', () => {
    expect(typedEnum('nope' as never, undefined as never, ctx())).toHaveLength(0)
    expect(typedEnum(null as never, undefined as never, ctx())).toHaveLength(0)
  })
})
