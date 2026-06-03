import { describe, expect, it } from 'vitest'

import { assert } from './assert'
import type { ValidationFailedError } from './types'

describe('assert', () => {
  it('returns the input unchanged when it is valid', () => {
    const input = { id: 1, name: 'Ada' }
    const result = assert(
      {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      input,
    )
    expect(result).toBe(input)
  })

  it('throws when the input is invalid', () => {
    expect(() => assert({ type: 'string' }, 42)).toThrow()
  })

  it('throws an Error whose message lists each failure with its path', () => {
    expect(() =>
      assert(
        {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
        { a: 1, b: 'x' },
      ),
    ).toThrow(/Validation failed with 2 errors/)
  })

  it('shows the root path as <root> in the message', () => {
    expect(() => assert({ type: 'object' }, 'nope')).toThrow(/<root>: must be object/)
  })

  it('attaches the structured errors to the thrown error', () => {
    try {
      assert({ type: 'integer' }, 3.5)
      expect.unreachable('assert should have thrown')
    } catch (error) {
      const failure = error as ValidationFailedError
      expect(failure).toBeInstanceOf(Error)
      expect(failure.name).toBe('ValidationFailedError')
      expect(failure.errors).toEqual([{ message: 'must be integer', path: '' }])
    }
  })

  it('uses the singular "error" in the message for a single failure', () => {
    expect(() => assert({ type: 'string' }, 1)).toThrow(/Validation failed with 1 error:/)
  })

  it('honours format options like validate', () => {
    expect(assert({ type: 'string', format: 'email' }, 'not-an-email')).toBe('not-an-email')

    expect(assert({ type: 'string', format: 'email' }, 'ada@example.com', { formats: 'all' })).toBe('ada@example.com')
    expect(() => assert({ type: 'string', format: 'email' }, 'not-an-email', { formats: 'all' })).toThrow()
  })

  it('reports a nested error with its JSON Pointer path', () => {
    try {
      assert({ type: 'array', items: { type: 'number' } }, [1, 'two', 3])
      expect.unreachable('assert should have thrown')
    } catch (error) {
      expect((error as ValidationFailedError).errors).toEqual([{ message: 'must be number', path: '/1' }])
    }
  })
})
