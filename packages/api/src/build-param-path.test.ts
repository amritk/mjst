import { describe, expect, it } from 'vitest'

import { buildParamPath } from './build-param-path'

describe('build-param-path', () => {
  it('percent-encodes plain parameters', () => {
    expect(buildParamPath('/users/{id}', { id: 'a b/c' })).toBe('/users/a%20b%2Fc')
  })

  it('keeps greedy parameter slashes as path structure', () => {
    expect(buildParamPath('/files/{path+}', { path: 'docs/q1 report.pdf' })).toBe('/files/docs/q1%20report.pdf')
  })

  it('stringifies non-string values', () => {
    expect(buildParamPath('/users/{id}', { id: 7 })).toBe('/users/7')
  })

  it('throws when a template parameter is missing', () => {
    expect(() => buildParamPath('/users/{id}', {})).toThrow("Missing path parameter 'id' for '/users/{id}'")
  })

  // Dots are unreserved, so encoding leaves them alone and the URL parser then
  // deletes the segment — '/users/..' would leave as a request for '/'.
  it('rejects dot segments that the URL parser would remove', () => {
    expect(() => buildParamPath('/users/{id}', { id: '..' })).toThrow(/cannot be '\.\.'/)
    expect(() => buildParamPath('/users/{id}', { id: '.' })).toThrow(/cannot be '\.'/)
  })

  it('rejects dot segments inside a greedy tail too', () => {
    expect(() => buildParamPath('/files/{path+}', { path: 'docs/../secrets' })).toThrow(/cannot be '\.\.'/)
  })

  it('allows values that merely contain dots', () => {
    expect(buildParamPath('/users/{id}', { id: '...' })).toBe('/users/...')
    expect(buildParamPath('/files/{path+}', { path: 'docs/..hidden/a.txt' })).toBe('/files/docs/..hidden/a.txt')
  })
})
