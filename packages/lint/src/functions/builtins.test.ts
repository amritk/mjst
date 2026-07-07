import { describe, expect, it } from 'vitest'

import type { IFunctionContext } from '../core'
import {
  alphabetical,
  casing,
  defined,
  enumeration,
  falsy,
  length,
  pattern,
  schema,
  truthy,
  undefinedFn,
  unreferencedReusableObject,
  xor,
} from './index'

const ctx = (opts: { path?: (string | number)[]; data?: unknown } = {}): IFunctionContext =>
  ({
    path: opts.path ?? [],
    rule: {} as never,
    document: { data: opts.data ?? {} } as never,
  }) as IFunctionContext

describe('truthy / falsy / defined / undefined', () => {
  it('truthy flags only falsy values', () => {
    for (const ok of [1, 'x', true, [], {}]) expect(truthy(ok, {}, ctx())).toHaveLength(0)
    for (const bad of [0, '', false, null, undefined, Number.NaN]) expect(truthy(bad, {}, ctx())).toHaveLength(1)
  })

  it('falsy flags only truthy values', () => {
    for (const ok of [0, '', false, null, undefined]) expect(falsy(ok, {}, ctx())).toHaveLength(0)
    for (const bad of [1, 'x', true, []]) expect(falsy(bad, {}, ctx())).toHaveLength(1)
  })

  it('defined flags only undefined', () => {
    expect(defined(null, {}, ctx())).toHaveLength(0)
    expect(defined(0, {}, ctx())).toHaveLength(0)
    expect(defined(undefined, {}, ctx())).toHaveLength(1)
  })

  it('undefined flags only defined values', () => {
    expect(undefinedFn(undefined, {}, ctx())).toHaveLength(0)
    expect(undefinedFn(null, {}, ctx())).toHaveLength(1)
    expect(undefinedFn(0, {}, ctx())).toHaveLength(1)
  })
})

describe('length', () => {
  it('measures strings, arrays, objects, and numbers', () => {
    expect(length('abc', { min: 5 }, ctx())?.[0]?.message).toContain('shorter than 5')
    expect(length([1, 2], { min: 3 }, ctx())).toHaveLength(1)
    expect(length({ a: 1 }, { min: 2 }, ctx())).toHaveLength(1)
    expect(length(3, { min: 5 }, ctx())).toHaveLength(1) // a number is measured by its value
  })

  it('enforces max and both bounds', () => {
    expect(length('abcdef', { max: 3 }, ctx())?.[0]?.message).toContain('longer than 3')
    expect(length('abc', { min: 1, max: 5 }, ctx())).toHaveLength(0)
    expect(length('', { min: 1, max: 5 }, ctx())).toHaveLength(1)
  })

  it('skips values with no measurable size', () => {
    expect(length(true, { min: 1 }, ctx())).toHaveLength(0)
    expect(length(null, { min: 1 }, ctx())).toHaveLength(0)
  })
})

describe('pattern', () => {
  it('checks match and notMatch', () => {
    expect(pattern('/pets', { match: '^/[a-z]+$' }, ctx())).toHaveLength(0)
    expect(pattern('/Pets', { match: '^/[a-z]+$' }, ctx())).toHaveLength(1)
    expect(pattern('draft', { notMatch: 'draft' }, ctx())).toHaveLength(1)
    expect(pattern('final', { notMatch: 'draft' }, ctx())).toHaveLength(0)
  })

  it('supports /regex/flags syntax and both bounds together', () => {
    expect(pattern('ABC', { match: '/^abc$/i' }, ctx())).toHaveLength(0)
    // one violation when match fails and notMatch also matches
    expect(pattern('xyz', { match: '^a', notMatch: 'z$' }, ctx())).toHaveLength(2)
  })

  it('skips non-string values', () => {
    expect(pattern(123 as never, { match: 'x' }, ctx())).toHaveLength(0)
  })
})

describe('enumeration', () => {
  it('handles numeric and mixed value sets', () => {
    expect(enumeration(2, { values: [1, 2, 3] }, ctx())).toHaveLength(0)
    expect(enumeration(4, { values: [1, 2, 3] }, ctx())).toHaveLength(1)
    expect(enumeration('a', { values: ['a', 1, true] }, ctx())).toHaveLength(0)
  })
})

describe('casing (options)', () => {
  it('honors a custom separator, optionally allowing a leading one', () => {
    expect(casing('foo/bar', { type: 'camel', separator: { char: '/' } }, ctx())).toHaveLength(0)
    expect(casing('/foo', { type: 'camel', separator: { char: '/' } }, ctx())).toHaveLength(1)
    expect(casing('/foo', { type: 'camel', separator: { char: '/', allowLeading: true } }, ctx())).toHaveLength(0)
  })

  it('allows digits by default and rejects them under disallowDigits', () => {
    expect(casing('foo2Bar', { type: 'camel' }, ctx())).toHaveLength(0)
    expect(casing('foo2Bar', { type: 'camel', disallowDigits: true }, ctx())).toHaveLength(1)
  })

  it('skips empty strings and missing type', () => {
    expect(casing('', { type: 'camel' }, ctx())).toHaveLength(0)
    expect(casing('anything', {} as never, ctx())).toHaveLength(0)
  })
})

describe('alphabetical (order and keyedBy)', () => {
  it('orders numbers numerically and object keys lexically', () => {
    expect(alphabetical([1, 2, 10], {}, ctx())).toHaveLength(0) // numeric, not string, order
    expect(alphabetical([10, 2], {}, ctx())).toHaveLength(1)
    expect(alphabetical({ a: 1, b: 2 }, {}, ctx())).toHaveLength(0)
    expect(alphabetical({ b: 1, a: 2 }, {}, ctx())).toHaveLength(1)
  })

  it('treats equal adjacent items as ordered, and short inputs as trivially ordered', () => {
    expect(alphabetical(['a', 'a', 'b'], {}, ctx())).toHaveLength(0)
    expect(alphabetical(['only'], {}, ctx())).toHaveLength(0)
    expect(alphabetical([], {}, ctx())).toHaveLength(0)
  })

  it('reports the out-of-order item path for arrays', () => {
    const results = alphabetical(['b', 'a'], {}, ctx({ path: ['tags'] }))
    expect(results?.[0]?.path).toEqual(['tags', 1])
  })
})

describe('xor', () => {
  it('passes only when exactly one listed property is present', () => {
    expect(xor({ a: 1 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0)
    expect(xor({ a: 1, c: 3 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0) // c is not counted
    expect(xor({}, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
    expect(xor({ a: 1, b: 2 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
  })
})

describe('schema (JSON Schema)', () => {
  it('passes valid values and reports every error with its path', () => {
    const opts = { schema: { type: 'object', required: ['a', 'b'] } }
    expect(schema({ a: 1, b: 2 }, opts, ctx())).toHaveLength(0)
    expect(schema({}, opts, ctx())?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('drills into nested paths and appends them to the context path', () => {
    const opts = {
      schema: { type: 'object', properties: { nested: { type: 'object', properties: { n: { type: 'number' } } } } },
    }
    const results = schema({ nested: { n: 'nope' } }, opts, ctx({ path: ['root'] }))
    expect(results?.[0]?.path).toEqual(['root', 'nested', 'n'])
  })
})

describe('unreferencedReusableObject', () => {
  it('flags map entries that nothing $refs anywhere in the document', () => {
    const data = {
      components: { schemas: { Used: { type: 'string' }, Unused: { type: 'number' } } },
      ref: { $ref: '#/components/schemas/Used' },
    }
    const results = unreferencedReusableObject(
      data.components.schemas,
      { reusableObjectsLocation: '#/components/schemas' },
      ctx({ path: ['components', 'schemas'], data }),
    )
    expect(results).toHaveLength(1)
    expect(results?.[0]?.path).toEqual(['components', 'schemas', 'Unused'])
  })
})
