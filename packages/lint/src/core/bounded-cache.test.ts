import { describe, expect, it } from 'vitest'

import { createBoundedCache } from './bounded-cache'

describe('bounded-cache', () => {
  it('reads back what it stored', () => {
    const cache = createBoundedCache<string, number>(4)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.size).toBe(1)
  })

  it('never grows past the limit, dropping the oldest entry', () => {
    const cache = createBoundedCache<string, number>(3)
    for (const key of ['a', 'b', 'c', 'd', 'e']) cache.set(key, 1)
    expect(cache.size).toBe(3)
    // 'a' and 'b' were the first in, so they are the first out.
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('e')).toBe(1)
  })

  it('overwrites an existing key without evicting anything', () => {
    const cache = createBoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 3)
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBe(3)
    expect(cache.get('b')).toBe(2)
  })
})
