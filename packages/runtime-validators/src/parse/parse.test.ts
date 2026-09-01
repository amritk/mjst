import { describe, expect, it } from 'vitest'
import { isValidationLimitError } from '@/interpreter/limits'

import { parse } from './parse'

describe('parse', () => {
  it('coerces a numeric string to the integer its schema declares', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer' } } })
    expect(parser({ page: '3' })).toEqual({ ok: true, value: { page: 3 } })
  })

  it('coerces a numeric string to a number, fraction included', () => {
    const parser = parse({ type: 'number' })
    expect(parser('1.5')).toEqual({ ok: true, value: 1.5 })
  })

  it("coerces only the exact strings 'true' and 'false' to booleans", () => {
    const parser = parse({ type: 'boolean' })
    expect(parser('true')).toEqual({ ok: true, value: true })
    expect(parser('false')).toEqual({ ok: true, value: false })
    // 'TRUE' is not a boolean literal, so it stays a string and is rejected —
    // guessing here would accept a typo as `true`.
    expect(parser('TRUE').ok).toBe(false)
  })

  it("coerces the string 'null' to null", () => {
    const parser = parse({ type: 'null' })
    expect(parser('null')).toEqual({ ok: true, value: null })
  })

  it('leaves a blank string alone rather than reading it as zero', () => {
    // `Number('')` and `Number('  ')` are both 0, which would turn a missing
    // query parameter into a real, wrong value.
    const parser = parse({ type: 'number' })
    expect(parser('').ok).toBe(false)
    expect(parser('   ').ok).toBe(false)
  })

  it('leaves a non-finite string alone rather than producing Infinity', () => {
    // `Number('Infinity')` passes a `typeof === 'number'` check and then
    // serializes back out as JSON `null` — silent corruption, not a rejection.
    const parser = parse({ type: 'number' })
    expect(parser('Infinity').ok).toBe(false)
    expect(parser('NaN').ok).toBe(false)
  })

  it('rejects a non-numeric string with a type error instead of coercing to NaN', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer' } } })
    const result = parser({ page: 'abc' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0]?.path).toBe('/page')
  })

  it('coerces a fractional string under `integer` so the error names integrality', () => {
    const result = parse({ type: 'integer' })('1.5')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0]?.message).toContain('integer')
  })

  it('fills an absent property from its default', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer', default: 1 } } })
    expect(parser({})).toEqual({ ok: true, value: { page: 1 } })
  })

  it('leaves a property that is present as null alone', () => {
    // `default` is an annotation about an *absent* property; a null the caller
    // sent is a value they chose, and overwriting it would discard their input.
    const parser = parse({
      type: 'object',
      properties: { page: { type: ['integer', 'null'], default: 1 } },
    })
    expect(parser({ page: null })).toEqual({ ok: true, value: { page: null } })
  })

  it('deep-copies a default so a caller cannot mutate the schema through it', () => {
    const schema = { type: 'object', properties: { tags: { type: 'array', default: ['a'] } } } as const
    const parser = parse(schema)
    const first = parser({})
    if (!first.ok) throw new Error('expected success')
    ;(first.value as { tags: string[] }).tags.push('b')
    expect(parser({})).toEqual({ ok: true, value: { tags: ['a'] } })
  })

  it('coerces inside nested objects and arrays', () => {
    const parser = parse({
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { ids: { type: 'array', items: { type: 'integer' } } },
        },
      },
    })
    expect(parser({ filter: { ids: ['1', '2'] } })).toEqual({ ok: true, value: { filter: { ids: [1, 2] } } })
  })

  it('coerces tuple positions independently of the rest', () => {
    const parser = parse({
      type: 'array',
      prefixItems: [{ type: 'integer' }, { type: 'boolean' }],
      items: { type: 'number' },
    })
    expect(parser(['1', 'true', '2.5'])).toEqual({ ok: true, value: [1, true, 2.5] })
  })

  it('coerces through additionalProperties', () => {
    const parser = parse({ type: 'object', additionalProperties: { type: 'integer' } })
    expect(parser({ a: '1', b: '2' })).toEqual({ ok: true, value: { a: 1, b: 2 } })
  })

  it('coerces through patternProperties', () => {
    const parser = parse({ type: 'object', patternProperties: { '^n_': { type: 'integer' } } })
    expect(parser({ n_a: '1', other: 'x' })).toEqual({ ok: true, value: { n_a: 1, other: 'x' } })
  })

  it('does not coerce at a union type, where the string branch is legitimate', () => {
    const parser = parse({ type: ['number', 'string'] })
    expect(parser('42')).toEqual({ ok: true, value: '42' })
  })

  it('does not coerce under anyOf or oneOf', () => {
    expect(parse({ anyOf: [{ type: 'number' }, { type: 'string' }] })('42')).toEqual({ ok: true, value: '42' })
    expect(parse({ oneOf: [{ type: 'number' }, { type: 'string' }] })('42')).toEqual({ ok: true, value: '42' })
  })

  it('still descends into properties declared alongside an anyOf', () => {
    // The ambiguity is about *this* node's own type; `properties` says the same
    // thing under every branch, so children still coerce.
    const parser = parse({
      properties: { page: { type: 'integer' } },
      anyOf: [{ type: 'object' }, { type: 'string' }],
    })
    expect(parser({ page: '3' })).toEqual({ ok: true, value: { page: 3 } })
  })

  it('coerces to a type declared inside allOf', () => {
    const parser = parse({ allOf: [{ type: 'integer' }] })
    expect(parser('7')).toEqual({ ok: true, value: 7 })
  })

  it('coerces through a local $ref', () => {
    const parser = parse({
      type: 'object',
      properties: { page: { $ref: '#/$defs/count' } },
      $defs: { count: { type: 'integer' } },
    })
    expect(parser({ page: '3' })).toEqual({ ok: true, value: { page: 3 } })
  })

  it('terminates on a self-referential $ref', () => {
    const parser = parse({ $ref: '#' })
    expect(parser('x')).toEqual({ ok: true, value: 'x' })
  })

  it('coerces a recursive structure to its full depth', () => {
    const parser = parse({
      type: 'object',
      properties: { value: { type: 'integer' }, next: { $ref: '#' } },
    })
    expect(parser({ value: '1', next: { value: '2', next: { value: '3' } } })).toEqual({
      ok: true,
      value: { value: 1, next: { value: 2, next: { value: 3 } } },
    })
  })

  it('returns the very same object when nothing needed coercing', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer' } } })
    const input = { page: 3 }
    const result = parser(input)
    if (!result.ok) throw new Error('expected success')
    expect(result.value).toBe(input)
  })

  it('never mutates its input', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer' } } })
    const input = { page: '3' }
    parser(input)
    expect(input).toEqual({ page: '3' })
  })

  it('honors coerce: false while still filling defaults', () => {
    const parser = parse(
      { type: 'object', properties: { page: { type: 'integer', default: 1 }, size: { type: 'integer' } } },
      { coerce: false },
    )
    const result = parser({ size: '20' })
    expect(result.ok).toBe(false)
    const filled = parser({ size: 20 })
    expect(filled).toEqual({ ok: true, value: { size: 20, page: 1 } })
  })

  it('honors defaults: false while still coercing', () => {
    const parser = parse({ type: 'object', properties: { page: { type: 'integer', default: 1 } } }, { defaults: false })
    expect(parser({ page: '3' })).toEqual({ ok: true, value: { page: 3 } })
    expect(parser({})).toEqual({ ok: true, value: {} })
  })

  it('enforces the formats option, as a validation does', () => {
    const parser = parse({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(parser('nope').ok).toBe(false)
    expect(parser('a@b.com').ok).toBe(true)
  })

  it('reports every validation error, with JSON Pointer paths', () => {
    const parser = parse({
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
      required: ['a', 'b'],
    })
    const result = parser({})
    if (result.ok) throw new Error('expected failure')
    expect(result.errors).toHaveLength(2)
  })

  it('bounds the coercion walk with the same limits a validation runs under', () => {
    // A deeply nested value under a self-referential schema must hit the ceiling
    // rather than overflowing the stack.
    let deep: Record<string, unknown> = { value: '1' }
    for (let i = 0; i < 200; i++) deep = { next: deep }
    const parser = parse(
      { type: 'object', properties: { value: { type: 'integer' }, next: { $ref: '#' } } },
      {
        limits: { maxDepth: 10 },
      },
    )
    try {
      parser(deep)
      throw new Error('expected a limit error')
    } catch (error) {
      expect(isValidationLimitError(error)).toBe(true)
    }
  })

  it('keeps a __proto__ key an ordinary property instead of reparenting the result', () => {
    // A plain `out[key] = value` on the rebuilt object would hit the
    // `Object.prototype` setter: the key would vanish as a property and silently
    // become the object's prototype instead — so the validator that judges the
    // result would be looking at different keys than the parser produced.
    const parser = parse({ type: 'object', additionalProperties: { type: 'integer' } })
    const input = JSON.parse('{"__proto__": "5", "a": "1"}')
    const result = parser(input)
    if (!result.ok) throw new Error('expected success')
    const value = result.value as Record<string, unknown>
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(value['__proto__']).toBe(5)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('keeps a defaulted __proto__ an ordinary property', () => {
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"default":"filled"}}}')
    const result = parse(schema)({})
    if (!result.ok) throw new Error('expected success')
    const value = result.value as Record<string, unknown>
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(value['__proto__']).toBe('filled')
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  })
})
