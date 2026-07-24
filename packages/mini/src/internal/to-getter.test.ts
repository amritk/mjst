import { describe, expect, it } from 'vitest'

import { toGetter } from './to-getter'

describe('to-getter', () => {
  it('returns a function value untouched so it stays reactive', () => {
    const getter = () => 5
    expect(toGetter(getter)).toBe(getter)
  })

  it('wraps a plain value in a constant getter', () => {
    const get = toGetter(42)
    expect(get()).toBe(42)
  })

  it('wraps falsy values without treating them as absent', () => {
    expect(toGetter(0)()).toBe(0)
    expect(toGetter('')()).toBe('')
    expect(toGetter(false)()).toBe(false)
  })
})
