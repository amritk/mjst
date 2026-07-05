import { describe, expect, it } from 'vitest'

import { multipleOfFailExpr, multipleOfPassExpr } from './multiple-of-check'

describe('multiple-of-check', () => {
  it('emits an epsilon-relative pass expression, not a float-wrong `% === 0`', () => {
    const expr = multipleOfPassExpr('x', 0.1)
    expect(expr).toBe('Math.abs(x / 0.1 - Math.round(x / 0.1)) <= 1e-8 * Math.max(1, Math.abs(x / 0.1))')
  })

  it('emits the negated fail expression for error conditions', () => {
    const expr = multipleOfFailExpr('x', 0.1)
    expect(expr).toBe('Math.abs(x / 0.1 - Math.round(x / 0.1)) > 1e-8 * Math.max(1, Math.abs(x / 0.1))')
  })

  it('the emitted pass expression accepts a value the naive `% === 0` rejects', () => {
    // The whole point: `0.3 % 0.1` is `0.0999…`, so `% === 0` would wrongly reject
    // `0.3` against `multipleOf: 0.1`. The epsilon check accepts it.
    const passes = (value: number, divisor: number): boolean => {
      const q = value / divisor
      return Math.abs(q - Math.round(q)) <= 1e-8 * Math.max(1, Math.abs(q))
    }
    expect(0.3 % 0.1 === 0).toBe(false)
    expect(passes(0.3, 0.1)).toBe(true)
    expect(passes(0.35, 0.1)).toBe(false)
    // Large values whose quotient representation error exceeds a fixed 1e-8.
    expect(passes(1234567.89, 0.01)).toBe(true)
  })
})
