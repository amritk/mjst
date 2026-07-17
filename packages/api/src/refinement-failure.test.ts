import { describe, expect, it } from 'vitest'

import { refinementFailure } from './refinement-failure'

describe('refinement-failure', () => {
  it('labels the failure with the first issue source, defaulting to body', () => {
    expect(refinementFailure([{ message: 'too big' }]).source).toBe('body')
    expect(
      refinementFailure([
        { source: 'query', message: 'bad pair' },
        { source: 'body', message: 'x' },
      ]).source,
    ).toBe('query')
  })

  it('maps issues onto the standard validation error shape', () => {
    expect(refinementFailure([{ path: '/end', message: 'end before start' }, { message: 'no path' }]).errors).toEqual([
      { message: 'end before start', path: '/end' },
      { message: 'no path', path: '' },
    ])
  })
})
