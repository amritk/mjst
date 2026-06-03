import { describe, expect, it } from 'vitest'

import { assert } from './assert'
import type { ValidationFailedError } from './types'

describe('assert', () => {
  it('returns the input unchanged when it is valid', () => {
    const parse = assert({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    })

    const input = { id: 1, name: 'Ada' }
    expect(parse(input)).toBe(input)
  })

  it('throws when the input is invalid', () => {
    const parse = assert({ type: 'string' })
    expect(() => parse(42)).toThrow()
  })

  it('throws an Error whose message lists each failure with its path', () => {
    const parse = assert({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })

    expect(() => parse({ a: 1, b: 'x' })).toThrow(/Validation failed with 2 errors/)
  })

  it('shows the root path as <root> in the message', () => {
    const parse = assert({ type: 'object' })
    expect(() => parse('nope')).toThrow(/<root>: must be object/)
  })

  it('attaches the structured errors to the thrown error', () => {
    const parse = assert({ type: 'integer' })

    try {
      parse(3.5)
      expect.unreachable('assert should have thrown')
    } catch (error) {
      const failure = error as ValidationFailedError
      expect(failure).toBeInstanceOf(Error)
      expect(failure.name).toBe('ValidationFailedError')
      expect(failure.errors).toEqual([{ message: 'must be integer', path: '' }])
    }
  })

  it('uses the singular "error" in the message for a single failure', () => {
    const parse = assert({ type: 'string' })
    expect(() => parse(1)).toThrow(/Validation failed with 1 error:/)
  })

  it('honours format options like validate', () => {
    const lenient = assert({ type: 'string', format: 'email' })
    expect(lenient('not-an-email')).toBe('not-an-email')

    const strict = assert({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(strict('ada@example.com')).toBe('ada@example.com')
    expect(() => strict('not-an-email')).toThrow()
  })

  it('reports a nested error with its JSON Pointer path', () => {
    const parse = assert({ type: 'array', items: { type: 'number' } })

    try {
      parse([1, 'two', 3])
      expect.unreachable('assert should have thrown')
    } catch (error) {
      expect((error as ValidationFailedError).errors).toEqual([{ message: 'must be number', path: '/1' }])
    }
  })
})
