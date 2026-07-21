import { describe, expect, it } from 'vitest'

import { negotiateMediaType, parseAccept } from './negotiate'

describe('negotiate', () => {
  it('parses and orders by quality', () => {
    const entries = parseAccept('text/html;q=0.8, application/json, text/plain;q=0.9')
    expect(entries.map((entry) => entry.type)).toEqual(['application/json', 'text/plain', 'text/html'])
  })

  it('picks the client-preferred offer', () => {
    expect(negotiateMediaType('application/json, text/csv;q=0.9', ['text/csv', 'application/json'])).toBe(
      'application/json',
    )
  })

  it('matches wildcards', () => {
    expect(negotiateMediaType('application/*', ['application/json'])).toBe('application/json')
    expect(negotiateMediaType('*/*', ['text/csv'])).toBe('text/csv')
  })

  it('returns the first offer when Accept is missing or empty', () => {
    expect(negotiateMediaType(null, ['application/json', 'text/csv'])).toBe('application/json')
    expect(negotiateMediaType('', ['application/json'])).toBe('application/json')
    expect(negotiateMediaType(undefined, ['application/json'])).toBe('application/json')
  })

  it('returns undefined when nothing is acceptable', () => {
    expect(negotiateMediaType('application/xml', ['application/json', 'text/csv'])).toBeUndefined()
  })

  it('honors an explicit q=0 rejection', () => {
    // */* would allow json, but json is explicitly refused.
    expect(negotiateMediaType('application/json;q=0, */*', ['application/json'])).toBeUndefined()
  })

  it('returns undefined when there are no offers', () => {
    expect(negotiateMediaType('*/*', [])).toBeUndefined()
  })
})
