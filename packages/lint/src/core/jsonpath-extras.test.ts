import { describe, expect, it } from 'vitest'

import { compileQuery, query } from './jsonpath'

const doc = {
  list: ['a', 'b', 'c', 'd', 'e'],
  items: [
    { type: 'a', n: 1 },
    { type: 'b', n: 9 },
  ],
  'dotted.key': 42,
  info: { title: 'API' },
  "it's": 7,
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

describe('jsonpath engine: array slices', () => {
  it('selects a bounded slice [0:2]', () => {
    const matches = query(doc, '$.list[0:2]')
    expect(values(matches)).toEqual(['a', 'b'])
    expect(matches.map((m) => m.path)).toEqual([
      ['list', 0],
      ['list', 1],
    ])
  })

  it('selects a tail slice with a negative start [-1:]', () => {
    const matches = query(doc, '$.list[-1:]')
    expect(values(matches)).toEqual(['e'])
    expect(matches[0]?.path).toEqual(['list', 4])
  })

  it('selects every second element with a step [::2]', () => {
    expect(values(query(doc, '$.list[::2]'))).toEqual(['a', 'c', 'e'])
  })

  it('treats a bare colon as the whole array [:]', () => {
    expect(values(query(doc, '$.list[:]'))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('jsonpath engine: script subscripts', () => {
  it('supports the last-element form [(@.length-1)]', () => {
    const matches = query(doc, '$.list[(@.length-1)]')
    expect(values(matches)).toEqual(['e'])
    expect(matches[0]?.path).toEqual(['list', 4])
  })

  it('supports an offset from the end [(@.length-2)]', () => {
    expect(values(query(doc, '$.list[(@.length-2)]'))).toEqual(['d'])
  })

  it('rejects an unsupported script subscript loudly', () => {
    const compiled = compileQuery('$.list[(@.foo)]')
    expect(compiled.error).toBeDefined()
    expect(query(doc, '$.list[(@.foo)]')).toEqual([])
  })
})

describe('jsonpath engine: escapes and filter tokens', () => {
  it('resolves a key containing an escaped quote', () => {
    const matches = query(doc, "$['it\\'s']")
    expect(matches[0]?.value).toBe(7)
    expect(matches[0]?.path).toEqual(["it's"])
  })

  it('keeps a literal @ inside a quoted filter string intact', () => {
    // If the `@` inside the string were rewritten to the value token, `indexOf`
    // would search each element for itself (index 0) instead of for the literal
    // "@" (index -1), so none of the five elements would match.
    const matches = query(doc, "$.list[?(@.indexOf('@') === -1)]")
    expect(matches).toHaveLength(5)
  })

  it('exposes @path as the jsonpath-plus string form', () => {
    const matches = query(doc, '$.items[?(@path === "$[\'items\'][1]")]')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.path).toEqual(['items', 1])
  })

  it('exposes @root and @property inside a filter', () => {
    const nested = { parent: { a: { keep: true }, b: { keep: false } } }
    const rooted = query(nested, '$.parent[?(@root.parent && @property === "a")]')
    expect(rooted).toHaveLength(1)
    expect(rooted[0]?.path).toEqual(['parent', 'a'])
  })

  it('exposes @parentProperty inside a filter', () => {
    // For items of `$.list`, @parentProperty is the container's key ("list").
    const nested = { list: [{ id: 1 }, { id: 2 }], other: [{ id: 3 }] }
    const matches = query(nested, "$.list[?(@parentProperty === 'list')]")
    expect(matches).toHaveLength(2)
    expect(query(nested, "$.list[?(@parentProperty === 'other')]")).toHaveLength(0)
  })
})

describe('jsonpath engine: malformed expressions', () => {
  it('records a parse error and matches nothing when the root $ is missing', () => {
    const compiled = compileQuery('info.title')
    expect(compiled.error).toContain('$')
    expect(query(doc, 'info.title')).toEqual([])
  })

  it('records a parse error for an unterminated bracket', () => {
    const compiled = compileQuery('$.list[0')
    expect(compiled.error).toContain('Unterminated')
    expect(query(doc, '$.list[0')).toEqual([])
  })

  it('supports recursive parent and key selectors', () => {
    // `$..^` yields every node's parent; `$..~` yields every property key.
    const parents = query({ a: { b: 1 } }, '$..^')
    expect(parents.length).toBeGreaterThan(0)
    const keys = query({ a: 1, b: 2 }, '$..~').map((m) => m.value)
    expect(keys).toEqual(expect.arrayContaining(['a', 'b']))
  })
})
