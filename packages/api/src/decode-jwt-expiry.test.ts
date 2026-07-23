import { describe, expect, it } from 'vitest'

import { decodeJwtExpiry } from './decode-jwt-expiry'

/** Builds a JWT-shaped string with the given payload; signature is arbitrary. */
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('decode-jwt-expiry', () => {
  it('decodes the exp claim as epoch milliseconds', () => {
    // exp is seconds in the token; the client works in milliseconds.
    expect(decodeJwtExpiry(makeJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000)
  })

  it('reads exp from a payload with base64url-only characters and no padding', () => {
    // A payload chosen so its base64 contains + and / (→ - and _) and needs padding.
    const token = makeJwt({ exp: 1_699_999_999, sub: 'a>?>?b', data: 'ÿÿÿ' })
    expect(decodeJwtExpiry(token)).toBe(1_699_999_999_000)
  })

  it('decodes payloads with non-ASCII claims via UTF-8', () => {
    const token = makeJwt({ exp: 1_700_000_000, name: 'José 😀' })
    expect(decodeJwtExpiry(token)).toBe(1_700_000_000_000)
  })

  it('throws when the string is not a three-segment JWT', () => {
    expect(() => decodeJwtExpiry('not-a-jwt')).toThrow(/not a JWT/)
    expect(() => decodeJwtExpiry('only.two')).toThrow(/not a JWT/)
  })

  it('throws when the payload is not valid base64url JSON', () => {
    expect(() => decodeJwtExpiry('header.%%%%.sig')).toThrow(/not valid base64url JSON/)
  })

  it('throws when the exp claim is absent', () => {
    expect(() => decodeJwtExpiry(makeJwt({ sub: 'user-1' }))).toThrow(/no `exp` claim/)
  })

  it('throws when the exp claim is not a finite number', () => {
    expect(() => decodeJwtExpiry(makeJwt({ exp: 'soon' }))).toThrow(/not a finite number/)
  })
})
