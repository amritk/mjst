import { describe, expect, it } from 'vitest'

import { INLINE_KEY_LIMIT, unknownKeyCheck } from './unknown-key-check'

describe('unknown-key-check', () => {
  it('inlines !== comparisons below the threshold and hoists nothing', () => {
    const check = unknownKeyCheck(['id', 'name'], '_knownKeys0')

    expect(check.declarations).toEqual([])
    expect(check.isUnknown('_k')).toBe('_k !== "id" && _k !== "name"')
  })

  it('uses the constant true when there are no known keys', () => {
    const check = unknownKeyCheck([], '_knownKeys0')

    expect(check.declarations).toEqual([])
    expect(check.isUnknown('_k')).toBe('true')
  })

  it('hoists a Set and tests membership above the threshold', () => {
    const keys = Array.from({ length: INLINE_KEY_LIMIT + 1 }, (_, i) => `k${i}`)
    const check = unknownKeyCheck(keys, '_knownKeysFoo')

    expect(check.declarations).toEqual([`const _knownKeysFoo = new Set(${JSON.stringify(keys)})`])
    expect(check.isUnknown('_k')).toBe('!_knownKeysFoo.has(_k)')
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

    expect(check.isUnknown('_k')).toBe('_k !== "a\\"b" && _k !== "x-y"')
  })
})
