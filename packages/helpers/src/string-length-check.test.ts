import { describe, expect, it } from 'vitest'

import { maxLengthFailExpr, maxLengthPassExpr, minLengthFailExpr, minLengthPassExpr } from './string-length-check'

/**
 * The emitted expressions are evaluated here rather than string-matched: what
 * matters is that they agree with JSON Schema's code-point counting for every
 * input, including the surrogate-pair band where the cheap unit count and the
 * exact count disagree.
 */
const evaluate = (expr: string, value: string): boolean =>
  new Function('x', `return (${expr.replaceAll('x as string', 'x')});`)(value) as boolean

const codePoints = (value: string): number => Array.from(value).length

const SAMPLES = ['', 'a', 'ab', 'abc', 'abcd', '💩', '💩💩', '💩💩💩', 'a💩', '💩a💩', 'aa💩bb']

describe('string length checks', () => {
  it.each([0, 1, 2, 3, 4])('minLength %i agrees with the code-point count', (min) => {
    for (const value of SAMPLES) {
      const expected = codePoints(value) >= min
      expect(evaluate(minLengthPassExpr('x', min), value), `pass ${JSON.stringify(value)} >= ${min}`).toBe(expected)
      expect(evaluate(minLengthFailExpr('x', min), value), `fail ${JSON.stringify(value)} >= ${min}`).toBe(!expected)
    }
  })

  it.each([0, 1, 2, 3, 4])('maxLength %i agrees with the code-point count', (max) => {
    for (const value of SAMPLES) {
      const expected = codePoints(value) <= max
      expect(evaluate(maxLengthPassExpr('x', max), value), `pass ${JSON.stringify(value)} <= ${max}`).toBe(expected)
      expect(evaluate(maxLengthFailExpr('x', max), value), `fail ${JSON.stringify(value)} <= ${max}`).toBe(!expected)
    }
  })

  it('counts an astral character as one, where String#length counts two', () => {
    // The whole point: `"💩".length` is 2, so a raw `.length` accepted it against
    // `minLength: 2` (Ajv rejects) and rejected `"💩💩"` against `maxLength: 2`.
    expect(evaluate(minLengthPassExpr('x', 2), '💩')).toBe(false)
    expect(evaluate(maxLengthPassExpr('x', 2), '💩💩')).toBe(true)
  })

  it('collapses a zero lower bound, which every string satisfies', () => {
    expect(minLengthPassExpr('x', 0)).toBe('true')
    expect(minLengthFailExpr('x', 0)).toBe('false')
  })

  it('collapses `minLength: 1` to the unit count, which cannot disagree', () => {
    // One code unit is at least one code point, so the most common bound in real
    // schemas pays nothing for the code-point correctness.
    expect(minLengthPassExpr('x', 1)).toBe('(x.length >= 1)')
    expect(minLengthFailExpr('x', 1)).toBe('(x.length < 1)')
  })

  it('stays scan-free on the common path', () => {
    // The exact count is only reached inside the narrow band where the unit
    // count cannot decide, so an ASCII string never allocates.
    expect(maxLengthPassExpr('x', 5).startsWith('(x.length <= 5 ||')).toBe(true)
    expect(minLengthPassExpr('x', 5).startsWith('(x.length >= 5 &&')).toBe(true)
  })

  // A caller negating the single-comparison fast path used to get
  // `!x.length >= 1`, which parses as `(!x.length) >= 1` — constant `false`, so
  // the length check silently passed every string.
  it('parenthesizes every expression so a bare `!` negates the whole check', () => {
    for (const expr of [
      minLengthPassExpr('x', 1),
      minLengthPassExpr('x', 3),
      minLengthFailExpr('x', 1),
      minLengthFailExpr('x', 3),
      maxLengthPassExpr('x', 2),
      maxLengthFailExpr('x', 2),
    ]) {
      expect(expr.startsWith('(')).toBe(true)
      expect(expr.endsWith(')')).toBe(true)
    }
  })
})
