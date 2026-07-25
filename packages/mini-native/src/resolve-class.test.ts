import { describe, expect, it } from 'vitest'

import { resolveClass } from './resolve-class'

describe('resolve-class', () => {
  it('passes a plain string through verbatim', () => {
    expect(resolveClass('card')).toBe('card')
    expect(resolveClass('card wide')).toBe('card wide')
  })

  it('joins an array and drops its falsy entries', () => {
    expect(resolveClass(['card', false, 'wide', null, undefined, ''])).toBe('card wide')
  })

  it('flattens a nested array instead of stringifying it', () => {
    // `['a', ['b', 'c']]` used to resolve to `"a b,c"`, because the nested array
    // was handed to `String()`. Composing a class list out of shared fragments
    // is the ordinary way people use this, so nesting has to keep working.
    expect(resolveClass(['a', ['b', 'c']])).toBe('a b c')
    expect(resolveClass(['a', ['b', ['c', ['d']]]])).toBe('a b c d')
  })

  it('keeps the truthy keys of a toggle map', () => {
    expect(resolveClass({ card: true, on: false, wide: true })).toBe('card wide')
  })

  it('resolves a toggle map nested inside an array', () => {
    expect(resolveClass(['card', { on: true, off: false }])).toBe('card on')
  })

  it('resolves an array nested inside an array of toggle maps', () => {
    expect(resolveClass([{ card: true }, ['wide', { on: true }]])).toBe('card wide on')
  })

  it('resolves the nullish and false forms to an empty string', () => {
    // These are the values a `condition && 'name'` expression produces, so they
    // have to vanish rather than render as text.
    expect(resolveClass(null)).toBe('')
    expect(resolveClass(undefined)).toBe('')
    expect(resolveClass(false)).toBe('')
  })

  it('resolves an empty array and an all-falsy array to an empty string', () => {
    expect(resolveClass([])).toBe('')
    expect(resolveClass([false, null, undefined])).toBe('')
  })

  it('resolves an empty toggle map and an all-off map to an empty string', () => {
    expect(resolveClass({})).toBe('')
    expect(resolveClass({ card: false })).toBe('')
  })

  it('stringifies a value that is neither an array nor an object', () => {
    expect(resolveClass(7)).toBe('7')
    expect(resolveClass(true)).toBe('true')
  })
})
