import { describe, expect, it } from 'bun:test'
import { isObject } from '#parser/helpers/is-object'

describe('is-object', () => {
  it('returns true for plain object', () => {
    expect(isObject({})).toBe(true)
  })

  it('returns true for object with properties', () => {
    expect(isObject({ a: 1, b: 'hello' })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isObject(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isObject(undefined)).toBe(false)
  })

  it('returns false for array', () => {
    expect(isObject([])).toBe(false)
    expect(isObject([1, 2, 3])).toBe(false)
  })

  it('returns false for string', () => {
    expect(isObject('hello')).toBe(false)
  })

  it('returns false for number', () => {
    expect(isObject(42)).toBe(false)
    expect(isObject(0)).toBe(false)
  })

  it('returns false for boolean', () => {
    expect(isObject(true)).toBe(false)
    expect(isObject(false)).toBe(false)
  })

  it('returns true for Date object', () => {
    // This implementation returns true for Date since it is a simple typeof check
    expect(isObject(new Date())).toBe(true)
  })

  it('returns true for RegExp object', () => {
    expect(isObject(/test/)).toBe(true)
  })

  it('returns true for nested object', () => {
    expect(isObject({ nested: { deep: true } })).toBe(true)
  })

  it('returns true for Object.create(null)', () => {
    expect(isObject(Object.create(null))).toBe(true)
  })

  it('returns false for function', () => {
    expect(isObject(() => {})).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isObject('')).toBe(false)
  })
})
