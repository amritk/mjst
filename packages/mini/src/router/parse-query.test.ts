import { describe, expect, it } from 'vitest'

import { parseQuery } from './parse-query'

describe('parse-query', () => {
  it('parses a search string into a record', () => {
    expect(parseQuery('?tab=posts&page=2')).toEqual({ tab: 'posts', page: '2' })
  })

  it('tolerates a missing leading question mark', () => {
    expect(parseQuery('tab=posts')).toEqual({ tab: 'posts' })
  })

  it('returns an empty record for an empty search', () => {
    expect(parseQuery('')).toEqual({})
    expect(parseQuery('?')).toEqual({})
  })

  it('keeps the last value when a key repeats', () => {
    expect(parseQuery('?p=1&p=2')).toEqual({ p: '2' })
  })

  it('decodes percent-encoded values', () => {
    expect(parseQuery('?q=a%20b')).toEqual({ q: 'a b' })
  })
})
