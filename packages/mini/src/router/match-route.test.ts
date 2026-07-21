import { describe, expect, it } from 'vitest'

import { matchRoute } from './match-route'

describe('match-route', () => {
  it('matches a literal path with no params', () => {
    expect(matchRoute('/about', '/about')).toEqual({})
  })

  it('returns null when a literal segment differs', () => {
    expect(matchRoute('/about', '/contact')).toBeNull()
  })

  it('captures a named param', () => {
    expect(matchRoute('/users/:id', '/users/42')).toEqual({ id: '42' })
  })

  it('captures several params across segments', () => {
    expect(matchRoute('/users/:id/posts/:postId', '/users/7/posts/9')).toEqual({ id: '7', postId: '9' })
  })

  it('does not match when the path is longer than the pattern', () => {
    expect(matchRoute('/users/:id', '/users/7/extra')).toBeNull()
  })

  it('does not match when the path is shorter than the pattern', () => {
    expect(matchRoute('/users/:id', '/users')).toBeNull()
  })

  it('treats leading and trailing slashes as equivalent', () => {
    expect(matchRoute('/about/', '/about')).toEqual({})
    expect(matchRoute('about', '/about/')).toEqual({})
  })

  it('captures the remainder into rest with a trailing wildcard', () => {
    expect(matchRoute('/files/*', '/files/a/b/c')).toEqual({ rest: 'a/b/c' })
  })

  it('matches an empty rest when nothing follows the wildcard', () => {
    expect(matchRoute('/files/*', '/files')).toEqual({ rest: '' })
  })

  it('combines named params with a trailing wildcard', () => {
    expect(matchRoute('/u/:id/*', '/u/3/settings/profile')).toEqual({ id: '3', rest: 'settings/profile' })
  })

  it('decodes percent-encoded segments', () => {
    expect(matchRoute('/search/:q', '/search/hello%20world')).toEqual({ q: 'hello world' })
  })

  it('matches the root path', () => {
    expect(matchRoute('/', '/')).toEqual({})
  })
})
