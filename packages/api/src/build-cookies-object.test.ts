import { describe, expect, it } from 'vitest'

import { buildCookiesObject } from './build-cookies-object'
import type { Coercion } from './types'

const NO_COERCIONS = new Map<string, Coercion>()

describe('build-cookies-object', () => {
  it('reads declared cookies and ignores everything else', () => {
    const result = buildCookiesObject(
      'session=abc123; _ga=GA1.2.3; theme=dark',
      new Set(['session', 'theme']),
      NO_COERCIONS,
    )
    expect(result).toEqual({ session: 'abc123', theme: 'dark' })
  })

  it('returns an empty object for a missing or empty header', () => {
    expect(buildCookiesObject(undefined, new Set(['a']), NO_COERCIONS)).toEqual({})
    expect(buildCookiesObject('', new Set(['a']), NO_COERCIONS)).toEqual({})
  })

  it('trims whitespace, unquotes, and percent-decodes values', () => {
    const result = buildCookiesObject(
      'name = "Ada Lovelace" ;email=ada%40example.com',
      new Set(['name', 'email']),
      NO_COERCIONS,
    )
    expect(result).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' })
  })

  it('keeps malformed percent-escapes as raw text', () => {
    const result = buildCookiesObject('bad=%zz', new Set(['bad']), NO_COERCIONS)
    expect(result).toEqual({ bad: '%zz' })
  })

  it('coerces declared number and boolean cookies', () => {
    const coercions = new Map<string, Coercion>([
      ['visits', 'number'],
      ['consent', 'boolean'],
    ])
    const result = buildCookiesObject('visits=3; consent=true', new Set(['visits', 'consent']), coercions)
    expect(result).toEqual({ visits: 3, consent: true })
  })

  it('skips segments without an equals sign and preserves = inside values', () => {
    const result = buildCookiesObject('junk; token=a=b=c', new Set(['junk', 'token']), NO_COERCIONS)
    expect(result).toEqual({ token: 'a=b=c' })
  })

  // Browsers send the most specific cookie first, so an attacker-planted
  // `Path=/` duplicate lands last — keeping the first value is what stops it
  // shadowing the real session cookie.
  it('keeps the first value when a name repeats', () => {
    const result = buildCookiesObject('  s = xyz ; s=second', new Set(['s']), NO_COERCIONS)
    expect(result).toEqual({ s: 'xyz' })
  })

  it('keeps the first value even when it is empty', () => {
    const result = buildCookiesObject('session=; session=planted', new Set(['session']), NO_COERCIONS)
    expect(result).toEqual({ session: '' })
  })

  // `in` would report every prototype member as already present, silently
  // dropping a cookie the contract declared.
  it('reads a declared cookie whose name collides with an Object prototype member', () => {
    const result = buildCookiesObject('toString=ok', new Set(['toString']), NO_COERCIONS)
    expect(result).toEqual({ toString: 'ok' })
  })

  // A plain `cookies[name] = value` runs the prototype's `__proto__` setter
  // instead of creating a property, so the value used to vanish: the contract
  // below saw no cookie at all and `required: ['__proto__']` could never pass.
  // Asserted through `getOwnPropertyNames`/`hasOwn` rather than `toEqual`,
  // because an object literal spelling `__proto__` would hit the same setter.
  it('keeps a declared cookie named __proto__ as an ordinary own property', () => {
    const result = buildCookiesObject('__proto__=evil; session=abc', new Set(['__proto__', 'session']), NO_COERCIONS)
    expect(Object.getOwnPropertyNames(result).sort()).toEqual(['__proto__', 'session'])
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result['__proto__']).toBe('evil')
    // The record itself is untouched: a string value would never have polluted
    // anything, which is exactly why the drop was silent.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['evil']).toBeUndefined()
  })

  it('coerces a declared cookie named __proto__ like any other', () => {
    const coercions = new Map<string, Coercion>([['__proto__', 'number']])
    const result = buildCookiesObject('__proto__=42', new Set(['__proto__']), coercions)
    expect(result['__proto__']).toBe(42)
  })

  it('is case-sensitive on names, per RFC 6265', () => {
    const result = buildCookiesObject('Session=upper; session=lower', new Set(['session']), NO_COERCIONS)
    expect(result).toEqual({ session: 'lower' })
  })
})
