import { describe, expect, it } from 'vitest'

import { coercePrimitive } from './coerce-primitive'

describe('coerce-primitive', () => {
  it('converts numeric strings to numbers', () => {
    expect(coercePrimitive('42', 'number')).toBe(42)
    expect(coercePrimitive('-3.5', 'number')).toBe(-3.5)
  })

  it('keeps non-numeric strings so the validator reports a type error', () => {
    expect(coercePrimitive('abc', 'number')).toBe('abc')
  })

  // Number('') and Number('  ') are 0, which would silently accept blank input.
  it('keeps blank strings instead of coercing them to zero', () => {
    expect(coercePrimitive('', 'number')).toBe('')
    expect(coercePrimitive('   ', 'number')).toBe('   ')
  })

  // `Number('Infinity')` is a finite-looking `number` that JSON-serializes to
  // `null`, so it must be rejected as a string for the validator to catch.
  it('keeps non-finite strings so the validator reports a type error', () => {
    expect(coercePrimitive('Infinity', 'number')).toBe('Infinity')
    expect(coercePrimitive('-Infinity', 'number')).toBe('-Infinity')
  })

  it('still coerces exponential notation', () => {
    expect(coercePrimitive('1e3', 'number')).toBe(1000)
  })

  it('converts boolean strings', () => {
    expect(coercePrimitive('true', 'boolean')).toBe(true)
    expect(coercePrimitive('false', 'boolean')).toBe(false)
  })

  it('keeps non-boolean strings unchanged', () => {
    expect(coercePrimitive('TRUE', 'boolean')).toBe('TRUE')
    expect(coercePrimitive('1', 'boolean')).toBe('1')
  })
})
