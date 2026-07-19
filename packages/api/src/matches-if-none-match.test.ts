import { describe, expect, it } from 'vitest'

import { matchesIfNoneMatch } from './matches-if-none-match'

const ETAG = '"a1b2c3d4"'

describe('matches-if-none-match', () => {
  it('matches an exact strong etag', () => {
    expect(matchesIfNoneMatch('"a1b2c3d4"', ETAG)).toBe(true)
  })

  it('rejects a different etag', () => {
    expect(matchesIfNoneMatch('"deadbeef"', ETAG)).toBe(false)
  })

  it('matches the * wildcard', () => {
    expect(matchesIfNoneMatch('*', ETAG)).toBe(true)
    expect(matchesIfNoneMatch('  *  ', ETAG)).toBe(true)
  })

  it('scans comma-separated lists', () => {
    expect(matchesIfNoneMatch('"deadbeef", "a1b2c3d4"', ETAG)).toBe(true)
    expect(matchesIfNoneMatch('"deadbeef", "cafebabe"', ETAG)).toBe(false)
  })

  it('applies weak comparison by stripping W/ prefixes', () => {
    expect(matchesIfNoneMatch('W/"a1b2c3d4"', ETAG)).toBe(true)
    expect(matchesIfNoneMatch('"x", W/"a1b2c3d4"', ETAG)).toBe(true)
  })

  it('rejects an unquoted or partial token', () => {
    expect(matchesIfNoneMatch('a1b2c3d4', ETAG)).toBe(false)
    expect(matchesIfNoneMatch('"a1b2"', ETAG)).toBe(false)
  })

  it('rejects an empty header value', () => {
    expect(matchesIfNoneMatch('', ETAG)).toBe(false)
  })
})
