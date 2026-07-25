import { describe, expect, it } from 'vitest'

import { defaultKey } from './default-key'

describe('default-key', () => {
  it('keys a primitive item by its own value', () => {
    expect(defaultKey('red', 0)).toBe('red')
    expect(defaultKey(7, 0)).toBe('7')
    expect(defaultKey(true, 0)).toBe('true')
  })

  it('prefers an id field on an object item', () => {
    expect(defaultKey({ id: 'a1' }, 3)).toBe('a1')
    expect(defaultKey({ id: 42 }, 3)).toBe('42')
  })

  it('falls back to a key field when there is no id', () => {
    expect(defaultKey({ key: 'k1' }, 3)).toBe('k1')
  })

  it('prefers id over key when an item carries both', () => {
    expect(defaultKey({ id: 'a1', key: 'k1' }, 3)).toBe('a1')
  })

  it('falls back to key when id is nullish', () => {
    expect(defaultKey({ id: null, key: 'k1' }, 3)).toBe('k1')
    expect(defaultKey({ id: undefined, key: 'k1' }, 3)).toBe('k1')
  })

  it('falls back to the position when an object offers no usable identity', () => {
    // This is the unsafe case the doc warns about: keying by position means an
    // insertion at the front renumbers everything after it, so every following
    // row is treated as changed. It is a last resort, not a default to rely on.
    expect(defaultKey({ name: 'sam' }, 3)).toBe('3')
    expect(defaultKey({}, 0)).toBe('0')
  })

  it('ignores an id that is neither a string nor a number', () => {
    // A nested object or an array would stringify to something meaningless, so
    // the position is the honest answer instead.
    expect(defaultKey({ id: { nested: true } }, 5)).toBe('5')
    expect(defaultKey({ id: ['a'] }, 5)).toBe('5')
  })

  it('falls back to the position for a nullish item', () => {
    expect(defaultKey(null, 2)).toBe('2')
    expect(defaultKey(undefined, 4)).toBe('4')
  })
})
