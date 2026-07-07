import { describe, expect, it } from 'vitest'

import { query } from './jsonpath'

const doc = {
  list: ['a', 'b', 'c'],
  items: [
    { type: 'a', n: 1 },
    { type: 'b', n: 9 },
  ],
  'dotted.key': 42,
  info: { title: 'API' },
}

const values = (matches: { value: unknown }[]) => matches.map((m) => m.value)

describe('jsonpath engine: indices and unions', () => {
  it('selects a single array index', () => {
    const matches = query(doc, '$.list[1]')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.value).toBe('b')
    expect(matches[0]?.path).toEqual(['list', 1])
  })

  it('selects a union of indices', () => {
    expect(values(query(doc, '$.list[0,2]'))).toEqual(['a', 'c'])
  })
})

describe('jsonpath engine: bracket children', () => {
  it('resolves quoted bracket children', () => {
    expect(query(doc, "$['info']['title']")[0]?.value).toBe('API')
  })

  it('resolves a key containing a dot via brackets', () => {
    const matches = query(doc, "$['dotted.key']")
    expect(matches[0]?.value).toBe(42)
    expect(matches[0]?.path).toEqual(['dotted.key'])
  })
})

describe('jsonpath engine: wildcards and filters', () => {
  it('maps a wildcard over array items', () => {
    expect(values(query(doc, '$.items[*].type'))).toEqual(['a', 'b'])
  })

  it('filters by property presence', () => {
    expect(query(doc, '$.items[?(@.type)]')).toHaveLength(2)
  })

  it('filters by a numeric comparison', () => {
    const matches = query(doc, '$.items[?(@.n > 5)]')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.path).toEqual(['items', 1])
  })
})
