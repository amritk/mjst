import { describe, expect, it } from 'vitest'

import { boundFailExpr, boundOperator, boundPassExpr } from './numeric-bound-check'

describe('numeric-bound-check', () => {
  it('emits inclusive bounds by default', () => {
    expect(boundPassExpr('x', 'minimum', 5)).toBe('(x >= 5)')
    expect(boundPassExpr('x', 'maximum', 10)).toBe('(x <= 10)')
  })

  it('emits strict bounds for the exclusive forms', () => {
    expect(boundPassExpr('x', 'minimum', 5, true)).toBe('(x > 5)')
    expect(boundPassExpr('x', 'maximum', 10, true)).toBe('(x < 10)')
  })

  it('emits the negated pass expression for error conditions, never a direct failure test', () => {
    // The negation is the whole contract: `!(x >= 5)` and `x < 5` differ only
    // for NaN, and only the first agrees with the interpreter.
    expect(boundFailExpr('x', 'minimum', 5)).toBe('!(x >= 5)')
    expect(boundFailExpr('x', 'maximum', 10, true)).toBe('!(x < 10)')
  })

  it('names the same operator in a message as the check it describes', () => {
    expect(boundOperator('minimum')).toBe('>=')
    expect(boundOperator('minimum', true)).toBe('>')
    expect(boundOperator('maximum')).toBe('<=')
    expect(boundOperator('maximum', true)).toBe('<')
  })

  it('fails NaN against every bound, matching the interpreter and Ajv', () => {
    // Evaluate the emitted expression rather than a transcription of it — the
    // emitted text is what actually has to be right.
    const passes = (expr: string, value: number): boolean => new Function('x', `return ${expr}`)(value) as boolean

    for (const expr of [
      boundPassExpr('x', 'minimum', 5),
      boundPassExpr('x', 'maximum', 10),
      boundPassExpr('x', 'minimum', 5, true),
      boundPassExpr('x', 'maximum', 10, true),
    ]) {
      expect(passes(expr, Number.NaN)).toBe(false)
    }
    for (const expr of [boundFailExpr('x', 'minimum', 5), boundFailExpr('x', 'maximum', 10)]) {
      expect(passes(expr, Number.NaN)).toBe(true)
    }
  })

  it('lets the infinities follow the ordinary comparison', () => {
    const passes = (expr: string, value: number): boolean => new Function('x', `return ${expr}`)(value) as boolean

    expect(passes(boundPassExpr('x', 'minimum', 0), Number.POSITIVE_INFINITY)).toBe(true)
    expect(passes(boundPassExpr('x', 'maximum', 10), Number.POSITIVE_INFINITY)).toBe(false)
    expect(passes(boundPassExpr('x', 'minimum', 0), Number.NEGATIVE_INFINITY)).toBe(false)
    expect(passes(boundPassExpr('x', 'maximum', 10), Number.NEGATIVE_INFINITY)).toBe(true)
  })

  it('is safe to drop into a boolean chain without re-bracketing', () => {
    const chain = `${boundPassExpr('x', 'minimum', 0)} && ${boundPassExpr('x', 'maximum', 10)}`
    const holds = (value: number): boolean => new Function('x', `return ${chain}`)(value) as boolean
    expect(holds(5)).toBe(true)
    expect(holds(11)).toBe(false)
    expect(holds(Number.NaN)).toBe(false)
  })
})
