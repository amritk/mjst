import { describe, expect, it } from 'vitest'

import { stripBase } from './strip-base'

describe('strip-base', () => {
  it('strips the base from a nested path', () => {
    expect(stripBase('/app/users', '/app')).toBe('/users')
  })

  it('maps the base itself to the root', () => {
    expect(stripBase('/app', '/app')).toBe('/')
  })

  it('leaves a path untouched when the base is a coincidental character prefix', () => {
    // `/app` is not a real segment boundary of `/application`.
    expect(stripBase('/application', '/app')).toBe('/application')
  })

  it('leaves a non-prefixed path untouched', () => {
    expect(stripBase('/other', '/app')).toBe('/other')
  })

  it('returns the pathname unchanged when there is no base', () => {
    expect(stripBase('/users', '')).toBe('/users')
  })
})
