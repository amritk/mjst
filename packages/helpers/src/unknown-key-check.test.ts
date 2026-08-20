import { describe, expect, it } from 'vitest'

import { INLINE_KEY_LIMIT, unknownKeyCheck } from './unknown-key-check'

describe('unknown-key-check', () => {
  it('inlines !== comparisons below the threshold and hoists nothing', () => {
    const check = unknownKeyCheck(['id', 'name'], '_knownKeys0')

    expect(check.declarations).toEqual([])
    expect(check.isUnknown('_k')).toBe('(_k !== "id" && _k !== "name")')
    expect(check.isKnown('_k')).toBe('(_k === "id" || _k === "name")')
  })

  it('uses the constant true/false when there are no known keys', () => {
    const check = unknownKeyCheck([], '_knownKeys0')

    expect(check.declarations).toEqual([])
    expect(check.isUnknown('_k')).toBe('true')
    expect(check.isKnown('_k')).toBe('false')
  })

  it('hoists a Set and tests membership above the threshold', () => {
    const keys = Array.from({ length: INLINE_KEY_LIMIT + 1 }, (_, i) => `k${i}`)
    const check = unknownKeyCheck(keys, '_knownKeysFoo')

    expect(check.declarations).toEqual([`const _knownKeysFoo = new Set(${JSON.stringify(keys)})`])
    expect(check.isUnknown('_k')).toBe('!_knownKeysFoo.has(_k)')
    expect(check.isKnown('_k')).toBe('_knownKeysFoo.has(_k)')
  })

  it('stays inline exactly at the threshold', () => {
    const keys = Array.from({ length: INLINE_KEY_LIMIT }, (_, i) => `k${i}`)
    const check = unknownKeyCheck(keys, '_knownKeys0')

    expect(check.declarations).toEqual([])
    expect(check.isUnknown('_k')).toContain('!==')
  })

  it('honours a custom inline limit', () => {
    const check = unknownKeyCheck(['a', 'b', 'c'], '_known', 2)

    expect(check.declarations).toEqual(['const _known = new Set(["a","b","c"])'])
    expect(check.isUnknown('_k')).toBe('!_known.has(_k)')
  })

  it('JSON-escapes keys with quotes or special characters', () => {
    const check = unknownKeyCheck(['a"b', 'x-y'], '_known')

    expect(check.isUnknown('_k')).toBe('(_k !== "a\\"b" && _k !== "x-y")')
  })

  // The inline chain and the hoisted `Set.has` have to be interchangeable as
  // single terms: a caller writing `x && check.isKnown(k)` got `(x && a) || b`
  // below the limit and correct code above it, so the bug appeared and
  // disappeared with a key count. Evaluated rather than string-matched — what
  // matters is how the expression composes, not how it is spelled.
  it('composes as one term on either side of the inline limit', () => {
    const many = Array.from({ length: 20 }, (_, index) => `k${index}`)

    for (const keys of [['id'], ['id', 'name'], many]) {
      const check = unknownKeyCheck(keys, '_known')
      const evaluate = (expr: string, key: string, guard: boolean): boolean =>
        new Function('_known', '_k', '_guard', `return ${expr};`)(new Set(keys), key, guard) as boolean

      for (const [expr, expected] of [
        [check.isKnown('_k'), true],
        [check.isUnknown('_k'), false],
      ] as const) {
        // Negation, and use as the right operand of `&&` — the two placements a
        // bare `a || b` silently breaks under.
        expect(evaluate(expr, keys[0] as string, true)).toBe(expected)
        expect(evaluate(`!${expr}`, keys[0] as string, true)).toBe(!expected)
        expect(evaluate(`_guard && ${expr}`, keys[0] as string, false)).toBe(false)
        expect(evaluate(`_guard && ${expr}`, 'nope', true)).toBe(!expected)
      }
    }
  })

  // A key set that is empty yields the constants, which need no bracketing.
  it('still yields bare constants when there are no known keys', () => {
    const check = unknownKeyCheck([], '_known')

    expect(check.isUnknown('_k')).toBe('true')
    expect(check.isKnown('_k')).toBe('false')
  })
})
