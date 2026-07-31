import { describe, expect, it } from 'vitest'

import { appendCookies } from './append-cookies'

describe('append-cookies', () => {
  it('percent-encodes values onto the cookie header and skips undefined', () => {
    const headers = new Headers()
    appendCookies(headers, { session: 'abc 123', visits: 2, skipped: undefined })
    expect(headers.get('cookie')).toBe('session=abc%20123; visits=2')
  })

  it('appends after a cookie header an earlier source already set', () => {
    const headers = new Headers({ cookie: 'existing=1' })
    appendCookies(headers, { session: 'abc' })
    expect(headers.get('cookie')).toBe('existing=1; session=abc')
  })

  it('leaves the headers untouched when every value is undefined', () => {
    const headers = new Headers()
    appendCookies(headers, { skipped: undefined })
    expect(headers.get('cookie')).toBeNull()
  })
})
