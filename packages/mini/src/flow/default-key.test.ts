import { describe, expect, it } from 'vitest'

import { defaultKey } from './default-key'

describe('default-key', () => {
  it('uses an object string id', () => {
    expect(defaultKey({ id: 'abc' }, 3)).toBe('abc')
  })

  it('stringifies an object number id', () => {
    expect(defaultKey({ id: 7 }, 3)).toBe('7')
  })

  it('uses a primitive item as its own key', () => {
    expect(defaultKey('hello', 3)).toBe('hello')
    expect(defaultKey(42, 3)).toBe('42')
  })

  it('falls back to the index when an object has no usable id', () => {
    // A boolean id is not a stable identity, so it drops to the index hazard.
    expect(defaultKey({ id: true }, 5)).toBe('5')
    expect(defaultKey({ name: 'x' }, 2)).toBe('2')
  })

  it('falls back to the index for a bare object', () => {
    expect(defaultKey({}, 4)).toBe('4')
  })
})
