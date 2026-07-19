import { describe, expect, it } from 'vitest'

import { toSearchParams } from './to-search-params'

describe('to-search-params', () => {
  it('repeats the key for array values', () => {
    expect(toSearchParams({ tags: ['a', 'b'] }).toString()).toBe('tags=a&tags=b')
  })

  it('stringifies scalars and skips undefined', () => {
    expect(toSearchParams({ verbose: true, count: 2, missing: undefined }).toString()).toBe('verbose=true&count=2')
  })
})
