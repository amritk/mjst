import { describe, expect, it } from 'vitest'

import { buildResponseHeaders } from './build-response-headers'

describe('build-response-headers', () => {
  it('sends an array value as separate header lines', () => {
    const headers = buildResponseHeaders({ 'set-cookie': ['a=1; Path=/', 'b=2; HttpOnly'] })
    expect(headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; HttpOnly'])
  })

  it('keeps single string values as one line', () => {
    const headers = buildResponseHeaders({ 'x-one': 'value' })
    expect(headers.get('x-one')).toBe('value')
  })

  it('seeds the default content type but lets a custom one win', () => {
    expect(buildResponseHeaders({}, 'application/json').get('content-type')).toBe('application/json')
    expect(
      buildResponseHeaders({ 'content-type': 'application/problem+json' }, 'application/json').get('content-type'),
    ).toBe('application/problem+json')
  })

  it('treats an array as the complete set for its name', () => {
    // A default content-type must not linger next to an array override.
    const headers = buildResponseHeaders({ 'content-type': ['text/a', 'text/b'] }, 'application/json')
    expect(headers.get('content-type')).toBe('text/a, text/b')
  })
})
