import { describe, expect, it } from 'vitest'

import { hasExactKeyCount } from './has-exact-key-count'

describe('has-exact-key-count', () => {
  it('matches an exact own-key count', () => {
    expect(hasExactKeyCount({ a: 1, b: 2 }, 2)).toBe(true)
  })

  it('rejects an extra key', () => {
    expect(hasExactKeyCount({ a: 1, b: 2, c: 3 }, 2)).toBe(false)
  })

  it('rejects a missing key', () => {
    expect(hasExactKeyCount({ a: 1 }, 2)).toBe(false)
  })

  it('matches the empty object against a count of zero', () => {
    expect(hasExactKeyCount({}, 0)).toBe(true)
    expect(hasExactKeyCount({ a: 1 }, 0)).toBe(false)
  })

  it('ignores non-enumerable own properties, like Object.keys', () => {
    const value = { a: 1 }
    Object.defineProperty(value, 'hidden', { value: 2, enumerable: false })
    expect(hasExactKeyCount(value, 1)).toBe(true)
  })

  it('rejects a non-plain prototype even when the own-key count matches', () => {
    // The prototype guard is what makes the for..in count agree with
    // Object.keys, and callers rely on it: a crafted prototype can satisfy a
    // fast path's typed checks through inherited values while the own count
    // still matches, so those inputs must fall through to the slow path.
    expect(hasExactKeyCount(Object.create(null), 0)).toBe(false)
    expect(hasExactKeyCount(Object.assign(Object.create({ a: 1 }), { b: 2 }), 1)).toBe(false)
    expect(hasExactKeyCount(new (class Point {})(), 0)).toBe(false)
  })

  it('rejects arrays and other exotic objects', () => {
    expect(hasExactKeyCount([1, 2], 2)).toBe(false)
    expect(hasExactKeyCount(new Date(), 0)).toBe(false)
  })

  it('agrees with Object.keys().length on plain objects of every width', () => {
    for (let width = 0; width < 40; width++) {
      const value: Record<string, number> = {}
      for (let i = 0; i < width; i++) value[`k${i}`] = i
      expect(hasExactKeyCount(value, width)).toBe(Object.keys(value).length === width)
      expect(hasExactKeyCount(value, width + 1)).toBe(false)
      if (width > 0) expect(hasExactKeyCount(value, width - 1)).toBe(false)
    }
  })
})
