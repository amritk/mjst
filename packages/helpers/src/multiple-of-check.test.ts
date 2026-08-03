import { describe, expect, it } from 'vitest'

import { multipleOfFailExpr, multipleOfPassExpr } from './multiple-of-check'

describe('multiple-of-check', () => {
  it('emits an exact `%` check for an integer divisor', () => {
    expect(multipleOfPassExpr('x', 2)).toBe('(Number.isInteger(x) && x % 2 === 0)')
  })

  it('emits an epsilon-relative pass expression for a fractional divisor, not a float-wrong `% === 0`', () => {
    expect(multipleOfPassExpr('x', 0.1)).toBe(
      '(Math.abs(x / 0.1 - Math.round(x / 0.1)) <= 2 * Number.EPSILON * Math.max(1, Math.abs(x / 0.1)))',
    )
  })

  it('emits the negated pass expression for error conditions', () => {
    expect(multipleOfFailExpr('x', 2)).toBe('!(Number.isInteger(x) && x % 2 === 0)')
    expect(multipleOfFailExpr('x', 0.1)).toBe(
      '!(Math.abs(x / 0.1 - Math.round(x / 0.1)) <= 2 * Number.EPSILON * Math.max(1, Math.abs(x / 0.1)))',
    )
  })

  it('agrees with the runtime interpreter on the values the two used to split on', () => {
    // The emitted expression is what actually has to be right, so evaluate it
    // rather than a hand-copied transcription of it.
    const passes = (value: number, divisor: number): boolean =>
      new Function('x', `return ${multipleOfPassExpr('x', divisor)}`)(value) as boolean

    // The whole point of the quotient form: `0.3 % 0.1` is `0.0999…`, so a naive
    // `% === 0` would wrongly reject `0.3` against `multipleOf: 0.1`.
    expect(0.3 % 0.1 === 0).toBe(false)
    expect(passes(0.3, 0.1)).toBe(true)
    expect(passes(0.35, 0.1)).toBe(false)
    // Large values whose quotient representation error exceeds a fixed epsilon.
    expect(passes(1234567.89, 0.01)).toBe(true)
    // A half-cent past a whole dollar amount: the old `1e-8·|q|` tolerance was
    // ~10⁷× the actual representation error and swallowed this.
    expect(passes(1000000.005, 0.01)).toBe(false)
    // A quotient that overflows to `Infinity` makes the distance `NaN`; `<=`
    // reads that as a failure rather than a clean multiple.
    expect(passes(1e308, 0.123456789)).toBe(false)
    // An integer divisor takes the `%` branch, which is exact even where a
    // quotient check would not be — and rejects the non-finite values Ajv rejects.
    expect(passes(1e21, 1)).toBe(true)
    expect(passes(Number.POSITIVE_INFINITY, 2)).toBe(false)
  })
})
