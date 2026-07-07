import { describe, expect, it } from 'vitest'

import { parseJson, parseWithPointers, parseYaml } from './index'

describe('value typing', () => {
  it('resolves YAML scalars by the core schema and keeps versions as strings', () => {
    const { data } = parseYaml<Record<string, unknown>>(
      ['int: 42', 'float: 1.5', 'bool: true', 'nothing: null', 'version: 1.0.0', 'quoted: "42"'].join('\n'),
    )
    expect(data).toEqual({ int: 42, float: 1.5, bool: true, nothing: null, version: '1.0.0', quoted: '42' })
  })

  it('parses JSON scalars to their native types', () => {
    const { data } = parseJson<Record<string, unknown>>('{ "n": 42, "b": false, "z": null, "s": "x" }')
    expect(data).toEqual({ n: 42, b: false, z: null, s: 'x' })
  })
})

describe('flow-collection positions', () => {
  it('locates a value inside a YAML flow mapping', () => {
    const { data, getLocationForJsonPath } = parseYaml<{ obj: Record<string, number> }>('obj: { a: 1, b: 2 }')
    expect(data.obj).toEqual({ a: 1, b: 2 })
    const loc = getLocationForJsonPath(['obj', 'b'])
    expect(loc?.range.start.line).toBe(0)
    expect(loc).toBeDefined()
  })

  it('locates an element inside a JSON array', () => {
    const { getLocationForJsonPath } = parseJson('{ "tags": ["a", "b", "c"] }')
    const loc = getLocationForJsonPath(['tags', 2])
    expect(loc?.range.start.line).toBe(0)
  })
})

describe('parseWithPointers dispatch', () => {
  it('honors an explicit format override', () => {
    const { data } = parseWithPointers<{ a: number }>('{ "a": 1 }', { format: 'json' })
    expect(data.a).toBe(1)
  })

  it('detects JSON despite leading whitespace', () => {
    const { data } = parseWithPointers<{ a: number }>('\n\n  { "a": 1 }')
    expect(data.a).toBe(1)
  })
})
