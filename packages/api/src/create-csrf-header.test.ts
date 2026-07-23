import { describe, expect, it } from 'vitest'

import { createCsrfHeader } from './create-csrf-header'

describe('create-csrf-header', () => {
  it('echoes the csrf_token cookie in the x-csrf-token header by default', () => {
    const header = createCsrfHeader({ cookies: () => 'other=1; csrf_token=abc123; more=2' })
    expect(header()).toEqual({ 'x-csrf-token': 'abc123' })
  })

  it('returns no header when the cookie is absent', () => {
    const header = createCsrfHeader({ cookies: () => 'session=xyz' })
    expect(header()).toEqual({})
  })

  it('reads the current cookie value on each call', () => {
    let cookie = 'csrf_token=first'
    const header = createCsrfHeader({ cookies: () => cookie })
    expect(header()).toEqual({ 'x-csrf-token': 'first' })
    cookie = 'csrf_token=second'
    expect(header()).toEqual({ 'x-csrf-token': 'second' })
  })

  it('supports custom cookie and header names', () => {
    const header = createCsrfHeader({
      cookieName: 'xsrf',
      headerName: 'x-xsrf',
      cookies: () => 'xsrf=token-9',
    })
    expect(header()).toEqual({ 'x-xsrf': 'token-9' })
  })

  it('returns no header when there is no cookie source (non-DOM default)', () => {
    // document is undefined under the test runner, so the default source is ''.
    expect(createCsrfHeader()()).toEqual({})
  })
})
