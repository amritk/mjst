import { describe, expect, it } from 'vitest'

import { buildQueryObject } from './build-query-object'
import type { Coercion } from './types'

const plan = (entries: Record<string, Coercion>): ReadonlyMap<string, Coercion> => new Map(Object.entries(entries))

describe('build-query-object', () => {
  it('coerces planned keys and passes strings through', () => {
    const query = buildQueryObject(
      new URLSearchParams('limit=10&active=true&name=ada'),
      plan({ limit: 'number', active: 'boolean' }),
    )
    expect(query).toEqual({ limit: 10, active: true, name: 'ada' })
  })

  it('accumulates repeated keys into arrays when the schema declares one', () => {
    const query = buildQueryObject(
      new URLSearchParams('tag=a&tag=b&id=1&id=2'),
      plan({ tag: 'string-array', id: 'number-array' }),
    )
    expect(query).toEqual({ tag: ['a', 'b'], id: [1, 2] })
  })

  it('wraps a single occurrence of an array key in an array', () => {
    const query = buildQueryObject(new URLSearchParams('tag=a'), plan({ tag: 'string-array' }))
    expect(query).toEqual({ tag: ['a'] })
  })

  it('keeps the last value for repeated undeclared keys', () => {
    const query = buildQueryObject(new URLSearchParams('name=a&name=b'), plan({}))
    expect(query).toEqual({ name: 'b' })
  })

  it('leaves unparseable numbers as strings for the validator to reject', () => {
    const query = buildQueryObject(new URLSearchParams('limit=abc'), plan({ limit: 'number' }))
    expect(query).toEqual({ limit: 'abc' })
  })

  it('returns an empty object for an empty query string', () => {
    expect(buildQueryObject(new URLSearchParams(), plan({}))).toEqual({})
  })
})
