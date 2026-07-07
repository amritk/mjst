import { describe, expect, it } from 'vitest'

import { compileQuery, query } from './jsonpath'

const doc = {
  openapi: '3.1.0',
  info: { title: 'API', contact: { name: 'A' } },
  paths: {
    '/users': {
      get: { responses: { '200': { description: 'ok' } } },
      post: { responses: { '201': { description: 'created' } } },
    },
  },
  components: {
    schemas: {
      User: { type: 'object', enum: undefined, properties: { tags: { type: 'array' } } },
      Tag: { type: 'array' },
    },
  },
}

function paths(matches: { path: (string | number)[] }[]): string[] {
  return matches.map((m) => m.path.join('.')).sort()
}

describe('jsonpath engine', () => {
  it('selects the root with $', () => {
    const matches = query(doc, '$')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.value).toBe(doc)
    expect(matches[0]?.path).toEqual([])
  })

  it('resolves child segments', () => {
    const matches = query(doc, '$.info.contact')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.path).toEqual(['info', 'contact'])
    expect(matches[0]?.value).toEqual({ name: 'A' })
  })

  it('normalizes all-digit object keys to numbers (matching legacy behavior)', () => {
    const matches = query(doc, '$.paths[*][*].responses[*]')
    // Path segments for "200"/"201" object keys are normalized to numbers.
    expect(paths(matches)).toEqual(['paths./users.get.responses.200', 'paths./users.post.responses.201'])
  })

  it('expands wildcards over objects and arrays', () => {
    expect(paths(query(doc, '$.paths./users[*]'))).toEqual(['paths./users.get', 'paths./users.post'])
  })

  it('expands method unions', () => {
    const matches = query(doc, '$.paths[*][get,put,post,delete,options,head,patch,trace]')
    expect(paths(matches)).toEqual(['paths./users.get', 'paths./users.post'])
  })

  it('supports recursive descent for a named child', () => {
    const matches = query(doc, '$..description')
    expect(matches.map((m) => m.value).sort()).toEqual(['created', 'ok'])
  })

  it('supports the parent operator ^', () => {
    // Every object that has a `type` key.
    const matches = query(doc, '$..type^')
    const values = matches.map((m) => m.value)
    expect(values).toContainEqual({ type: 'object', enum: undefined, properties: { tags: { type: 'array' } } })
    expect(values).toContainEqual({ type: 'array' })
  })

  it('supports the property-name operator ~', () => {
    const matches = query(doc, '$.paths[*]~')
    expect(matches[0]?.value).toBe('/users')
    expect(matches[0]?.path).toEqual(['paths', '/users'])
  })

  it('supports filter expressions', () => {
    const matches = query(doc, "$..[?(@ && @.type === 'array')]")
    // Both array-typed schemas are selected.
    expect(matches).toHaveLength(2)
    for (const m of matches) expect((m.value as { type: string }).type).toBe('array')
  })

  it('caches compiled paths by expression', () => {
    expect(compileQuery('$.info')).toBe(compileQuery('$.info'))
  })

  it('returns nothing for null/undefined roots', () => {
    expect(query(null, '$.info')).toEqual([])
    expect(query(undefined, '$..x')).toEqual([])
  })
})
