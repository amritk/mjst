import { describe, expect, it } from 'vitest'

import type { IFunctionContext } from '../core'
import {
  alphabetical,
  casing,
  defined,
  enumeration,
  falsy,
  length,
  or,
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

  it('no-ops with neither bound and ignores non-number bounds', () => {
    expect(length('abc', {}, ctx())).toHaveLength(0)
    // a stray string bound must not be coerced into the comparison
    expect(length('abc', { min: '5' } as never, ctx())).toHaveLength(0)
    expect(length('abcdef', { max: '3' } as never, ctx())).toHaveLength(0)
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

  it('reports an invalid regular expression instead of throwing', () => {
    const results = pattern('abc', { match: '(' }, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.message).toContain('not a valid regular expression')
  })

  it('supports notMatch in /re/flags form', () => {
    expect(pattern('ABC', { notMatch: '/^abc$/i' }, ctx())).toHaveLength(1)
    expect(pattern('xyz', { notMatch: '/^abc$/i' }, ctx())).toHaveLength(0)
  })

  it('keeps distinct patterns separate in the cache', () => {
    // Two different patterns evaluated under the same rule must not collide.
    expect(pattern('abc', { match: '^abc$' }, ctx())).toHaveLength(0)
    expect(pattern('abc', { match: '^xyz$' }, ctx())).toHaveLength(1)
    expect(pattern('abc', { match: '^abc$' }, ctx())).toHaveLength(0)
  })

  it('resets lastIndex so a global-flag pattern is reusable', () => {
    // A cached /g regex would otherwise carry lastIndex between calls.
    expect(pattern('ab', { match: '/a/g' }, ctx())).toHaveLength(0)
    expect(pattern('ab', { match: '/a/g' }, ctx())).toHaveLength(0)
  })
})

describe('enumeration', () => {
  it('handles numeric and mixed value sets', () => {
    expect(enumeration(2, { values: [1, 2, 3] }, ctx())).toHaveLength(0)
    expect(enumeration(4, { values: [1, 2, 3] }, ctx())).toHaveLength(1)
    expect(enumeration('a', { values: ['a', 1, true] }, ctx())).toHaveLength(0)
  })

  it('no-ops without a values array', () => {
    expect(enumeration('x', {} as never, ctx())).toHaveLength(0)
    expect(enumeration('x', { values: 'a' } as never, ctx())).toHaveLength(0)
  })

  it('skips non-primitive input rather than flagging it by reference', () => {
    expect(enumeration({ a: 1 }, { values: ['a'] }, ctx())).toHaveLength(0)
    expect(enumeration([1], { values: [1] }, ctx())).toHaveLength(0)
    // primitives are still checked, including null
    expect(enumeration(null, { values: [null] }, ctx())).toHaveLength(0)
    expect(enumeration('nope', { values: ['a'] }, ctx())).toHaveLength(1)
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

  it('reports a single finding listing the valid types for an unknown type', () => {
    const results = casing('Foo', { type: 'Pascal' as never }, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.message).toContain('flat, camel, pascal, kebab, cobol, snake, macro')
  })

  it('accepts digit-leading segments after a separator for every separator style', () => {
    expect(casing('foo-2fa', { type: 'kebab' }, ctx())).toHaveLength(0)
    expect(casing('FOO-2FA', { type: 'cobol' }, ctx())).toHaveLength(0)
    expect(casing('foo_2fa', { type: 'snake' }, ctx())).toHaveLength(0)
    expect(casing('FOO_2FA', { type: 'macro' }, ctx())).toHaveLength(0)
  })

  it('rejects digit-leading segments when digits are disallowed', () => {
    expect(casing('foo-2fa', { type: 'kebab', disallowDigits: true }, ctx())).toHaveLength(1)
    expect(casing('foo-bar', { type: 'kebab', disallowDigits: true }, ctx())).toHaveLength(0)
  })

  it('treats a lone separator char as valid only when leading is allowed', () => {
    expect(casing('/', { type: 'camel', separator: { char: '/', allowLeading: true } }, ctx())).toHaveLength(0)
    expect(casing('/', { type: 'camel', separator: { char: '/' } }, ctx())).toHaveLength(1)
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

  it('orders integer-like object keys numerically instead of lexically', () => {
    // JS enumerates integer keys ascending, so this must not be a false positive.
    expect(alphabetical({ '2': 1, '10': 2 }, {}, ctx())).toHaveLength(0)
  })

  it('compares numeric strings and mixed numeric arrays like Spectral', () => {
    expect(alphabetical([2, '10'], {}, ctx())).toHaveLength(0)
    expect(alphabetical(['2', '10'], {}, ctx())).toHaveLength(0)
    expect(alphabetical(['10', '2'], {}, ctx())).toHaveLength(1)
  })

  it('compares decimal numeric strings numerically, not lexically', () => {
    // "9.5" < "10" numerically, so an ascending pair must not be flagged, and a
    // descending one must be. Lexical comparison would invert both.
    expect(alphabetical(['9.5', '10'], {}, ctx())).toHaveLength(0)
    expect(alphabetical(['10', '9.5'], {}, ctx())).toHaveLength(1)
    expect(alphabetical(['10', 2], {}, ctx())).toHaveLength(1)
  })

  it('reports non-object items under keyedBy', () => {
    const results = alphabetical([{ name: 'a' }, 5], { keyedBy: 'name' }, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.message).toContain('must be an object')
  })

  it('reports non-string/number comparands and missing keys under keyedBy', () => {
    const nestedValues = alphabetical([{ name: { deep: 1 } }, { name: { deep: 2 } }], { keyedBy: 'name' }, ctx())
    expect(nestedValues).toHaveLength(1)
    expect(nestedValues?.[0]?.message).toContain('must be one of the allowed types: number, string')

    // a missing key resolves to `undefined`, which is not an allowed comparand
    const missingKey = alphabetical([{ name: 'b' }, { other: 'a' }], { keyedBy: 'name' }, ctx())
    expect(missingKey).toHaveLength(1)
    expect(missingKey?.[0]?.message).toContain('must be one of the allowed types')
  })
})

describe('xor', () => {
  it('passes only when exactly one listed property is present', () => {
    expect(xor({ a: 1 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0)
    expect(xor({ a: 1, c: 3 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0) // c is not counted
    expect(xor({}, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
    expect(xor({ a: 1, b: 2 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(1)
  })

  it('no-ops on missing or malformed properties instead of flagging every node', () => {
    expect(xor({ a: 1 }, {} as never, ctx())).toHaveLength(0)
    expect(xor({ a: 1 }, { properties: [] } as never, ctx())).toHaveLength(0)
    expect(xor({ a: 1 }, { properties: ['a'] }, ctx())).toHaveLength(0)
    expect(xor({ a: 1 }, { properties: 'nope' } as never, ctx())).toHaveLength(0)
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

  it('surfaces a clearly-invalid schema as a finding instead of silently passing', () => {
    const results = schema('x', { schema: { type: 'Pascal' } } as never, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.message).toContain('unknown type')
  })

  it('detects an invalid type nested inside the schema', () => {
    const opts = { schema: { type: 'object', properties: { x: { type: 'stringg' } } } }
    expect(schema({ x: 'ok' }, opts as never, ctx())).toHaveLength(1)
  })

  it('reports only the first error by default and every error when allErrors is set', () => {
    const opts = { schema: { type: 'object', required: ['a', 'b', 'c'] } }
    expect(schema({}, opts, ctx())).toHaveLength(1)
    expect((schema({}, { ...opts, allErrors: true }, ctx()) ?? []).length).toBeGreaterThan(1)
  })

  it('maps numeric object keys in error paths to numbers', () => {
    const opts = { schema: { type: 'object', properties: { '2': { type: 'number' } } } }
    const results = schema({ '2': 'no' }, opts as never, ctx({ path: ['root'] }))
    expect(results?.[0]?.path).toEqual(['root', 2])
  })

  it('does not crash on non-object input', () => {
    expect(() => schema(null, { schema: { type: 'object' } }, ctx())).not.toThrow()
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

  it('treats a JSON-pointer-escaped key as referenced', () => {
    const data = {
      components: { schemas: { 'a/b': { type: 'string' } } },
      ref: { $ref: '#/components/schemas/a~1b' },
    }
    const results = unreferencedReusableObject(
      data.components.schemas,
      { reusableObjectsLocation: '#/components/schemas' },
      ctx({ path: ['components', 'schemas'], data }),
    )
    expect(results).toHaveLength(0)
  })

  it('treats a reference that points deeper into an object as a use', () => {
    const data = {
      components: { schemas: { Foo: { type: 'object', properties: { x: { type: 'string' } } } } },
      ref: { $ref: '#/components/schemas/Foo/properties/x' },
    }
    const results = unreferencedReusableObject(
      data.components.schemas,
      { reusableObjectsLocation: '#/components/schemas' },
      ctx({ path: ['components', 'schemas'], data }),
    )
    expect(results).toHaveLength(0)
  })

  it('no-ops without a reusableObjectsLocation', () => {
    expect(unreferencedReusableObject({ Foo: {} }, {} as never, ctx({ data: {} }))).toHaveLength(0)
  })
})

describe('or', () => {
  it('passes when at least one listed property is present', () => {
    expect(or({ a: 1 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0)
    expect(or({ b: 2, c: 3 }, { properties: ['a', 'b'] }, ctx())).toHaveLength(0)
  })

  it('flags when none of the listed properties is present', () => {
    const results = or({ c: 3 }, { properties: ['a', 'b'] }, ctx())
    expect(results).toHaveLength(1)
    expect(results?.[0]?.message).toBe('At least one of "a" or "b" must be defined')
  })

  it('abbreviates a long property list', () => {
    const results = or({}, { properties: ['a', 'b', 'c', 'd', 'e'] }, ctx())
    expect(results?.[0]?.message).toBe('At least one of "a" or "b" or "c" or 2 other properties must be defined')
  })

  it('no-ops on missing or too-short options', () => {
    expect(or({}, {} as never, ctx())).toHaveLength(0)
    expect(or({}, { properties: ['a'] }, ctx())).toHaveLength(0)
  })
})
