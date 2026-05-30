import { describe, expect, it } from 'vitest'

import { getByPointer } from './get-by-pointer'

describe('get-by-pointer', () => {
  const root = {
    info: { title: 'API' },
    paths: [{ get: { id: 1 } }, { post: { id: 2 } }],
    'weird/key': true,
    'tilde~key': false,
  }

  it('returns the root for an empty or bare-slash pointer', () => {
    expect(getByPointer(root, '')).toBe(root)
    expect(getByPointer(root, '/')).toBe(root)
  })

  it('navigates object keys', () => {
    expect(getByPointer(root, '/info/title')).toBe('API')
  })

  it('navigates array indices', () => {
    expect(getByPointer(root, '/paths/1/post/id')).toBe(2)
  })

  it('decodes ~1 and ~0 escapes', () => {
    expect(getByPointer(root, '/weird~1key')).toBe(true)
    expect(getByPointer(root, '/tilde~0key')).toBe(false)
  })

  it('percent-decodes URI-encoded segments', () => {
    const doc = { '{volume_id}': 'found', 'weird/key': true }
    expect(getByPointer(doc, '/%7Bvolume_id%7D')).toBe('found')
    // %2F in a segment must not be treated as a path separator
    expect(getByPointer(doc, '/weird%2Fkey')).toBe(true)
  })

  it('returns undefined when a segment is missing', () => {
    expect(getByPointer(root, '/info/nope')).toBeUndefined()
    expect(getByPointer(root, '/info/title/tooDeep')).toBeUndefined()
  })
})
