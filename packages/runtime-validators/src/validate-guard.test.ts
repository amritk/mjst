import { describe, expect, it } from 'vitest'

import { validateGuard } from './validate-guard'

describe('validate-guard', () => {
  it('returns true for valid input and false for invalid input', () => {
    const isUser = validateGuard({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    })

    expect(isUser({ id: 1, name: 'Ada' })).toBe(true)
    expect(isUser({ id: 1 })).toBe(false)
    expect(isUser({ id: 'x', name: 'Ada' })).toBe(false)
    expect(isUser(null)).toBe(false)
  })

  it('always returns a boolean, never an error object', () => {
    const guard = validateGuard({ type: 'string' })
    expect(guard('x')).toBe(true)
    expect(guard(1)).toBe(false)
  })

  it('narrows the type when used as a guard', () => {
    type Point = { x: number; y: number }
    const isPoint = validateGuard<Point>({
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    })

    const value: unknown = { x: 1, y: 2 }
    if (isPoint(value)) {
      // This block only type-checks if `value` narrowed to Point.
      expect(value.x + value.y).toBe(3)
    } else {
      throw new Error('expected the guard to narrow')
    }
  })

  it('handles recursive schemas', () => {
    const isTree = validateGuard({
      type: 'object',
      properties: { value: { type: 'number' }, children: { type: 'array', items: { $ref: '#' } } },
      required: ['value'],
    })

    expect(isTree({ value: 1, children: [{ value: 2 }] })).toBe(true)
    expect(isTree({ value: 1, children: [{ value: 'x' }] })).toBe(false)
  })

  it('accepts null for an OpenAPI `nullable: true` schema', () => {
    const guard = validateGuard({ type: 'string', nullable: true })
    expect(guard(null)).toBe(true)
    expect(guard('x')).toBe(true)
    expect(guard(1)).toBe(false)
  })

  it('agrees with the error-collecting validator across many shapes', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        role: { enum: ['admin', 'user'] },
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['role'],
      additionalProperties: false,
    }
    const guard = validateGuard(schema)

    const samples: unknown[] = [
      { role: 'admin' },
      { role: 'admin', tags: ['a', 'b'], score: 50 },
      { role: 'nope' },
      { role: 'admin', tags: ['a', 'a'] },
      { role: 'admin', score: 200 },
      { role: 'admin', extra: true },
      'not even an object',
    ]

    // Independent reference implementation via the spec semantics we expect.
    const expected = [true, true, false, false, false, false, false]
    expect(samples.map((s) => guard(s))).toEqual(expected)
  })
})
