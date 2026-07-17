import { describe, expect, it } from 'vitest'

import { parsePathPattern } from './parse-path-pattern'

describe('parse-path-pattern', () => {
  it('parses literal segments', () => {
    expect(parsePathPattern('/users/all')).toEqual(['users', 'all'])
  })

  it('parses parameter segments', () => {
    expect(parsePathPattern('/users/{id}/posts/{postId}')).toEqual([
      'users',
      { name: 'id' },
      'posts',
      { name: 'postId' },
    ])
  })

  it('parses the root path to zero segments', () => {
    expect(parsePathPattern('/')).toEqual([])
  })

  it('drops a trailing slash', () => {
    expect(parsePathPattern('/users/')).toEqual(['users'])
  })

  it('rejects a path without a leading slash', () => {
    expect(() => parsePathPattern('users')).toThrow(/must start with/)
  })

  it('rejects partial parameter segments', () => {
    expect(() => parsePathPattern('/files/{name}.json')).toThrow(/Partial path parameters/)
  })

  it('rejects an empty parameter name', () => {
    expect(() => parsePathPattern('/users/{}')).toThrow(/Invalid path parameter/)
  })

  it('rejects empty segments', () => {
    expect(() => parsePathPattern('/users//posts')).toThrow(/Empty path segment/)
  })

  it('parses a greedy tail parameter', () => {
    expect(parsePathPattern('/files/{path+}')).toEqual(['files', { name: 'path', greedy: true }])
  })

  it('rejects a greedy parameter that is not the last segment', () => {
    expect(() => parsePathPattern('/files/{path+}/meta')).toThrow(/must be the last segment/)
  })

  it('rejects an empty or malformed greedy parameter name', () => {
    expect(() => parsePathPattern('/files/{+}')).toThrow(/Invalid path parameter/)
    expect(() => parsePathPattern('/files/{pa+th+}')).toThrow(/Invalid path parameter/)
  })
})
