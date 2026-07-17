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

  it('is case-sensitive on names, per RFC 6265', () => {
    const result = buildCookiesObject('Session=upper; session=lower', new Set(['session']), NO_COERCIONS)
    expect(result).toEqual({ session: 'lower' })
  })
})
