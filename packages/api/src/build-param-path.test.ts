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
})
