import { describe, expect, it } from 'vitest'

import { detectFormat, parseJson, parseWithPointers, parseYaml } from './index'

describe('parseYaml', () => {
  const source = ['openapi: 3.1.0', 'info:', '  title: My API', '  version: 1.0.0', 'paths: {}'].join('\n')

  it('parses data', () => {
    const { data } = parseYaml<Record<string, unknown>>(source)
    expect(data).toEqual({ openapi: '3.1.0', info: { title: 'My API', version: '1.0.0' }, paths: {} })
  })

  it('locates a nested scalar value at exact line:column', () => {
    const { getLocationForJsonPath } = parseYaml(source)
    const loc = getLocationForJsonPath(['info', 'title'])
    expect(loc?.range.start).toEqual({ line: 2, character: 9 })
    expect(loc?.range.end).toEqual({ line: 2, character: 15 })
  })

  it('locates a top-level key value', () => {
    const { getLocationForJsonPath } = parseYaml(source)
    const loc = getLocationForJsonPath(['openapi'])
    expect(loc?.range.start).toEqual({ line: 0, character: 9 })
  })

  it('falls back to the closest ancestor when path is missing', () => {
    const { getLocationForJsonPath } = parseYaml(source)
    expect(getLocationForJsonPath(['info', 'description'])).toBeUndefined()
    const loc = getLocationForJsonPath(['info', 'description'], true)
    // The YAML block-map node begins at its first child (`title`).
    expect(loc?.range.start).toEqual({ line: 2, character: 2 })
  })

  it('locates array elements', () => {
    const { getLocationForJsonPath } = parseYaml('tags:\n  - name: a\n  - name: b\n')
    const loc = getLocationForJsonPath(['tags', 1, 'name'])
    expect(loc?.range.start.line).toBe(2)
  })

  it('reports duplicate keys as a diagnostic', () => {
    const { diagnostics } = parseYaml('a: 1\na: 2\n')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.severity).toBe(0)
  })

  it('disables duplicate-key detection when configured', () => {
    const { diagnostics } = parseYaml('a: 1\na: 2\n', { duplicateKeys: 'off' })
    expect(diagnostics).toHaveLength(0)
  })
})

describe('parseJson', () => {
  const source = '{\n  "openapi": "3.1.0",\n  "info": { "title": "My API" }\n}'

  it('parses and locates nested values', () => {
    const { data, getLocationForJsonPath } = parseJson<Record<string, unknown>>(source)
    expect(data).toEqual({ openapi: '3.1.0', info: { title: 'My API' } })
    const loc = getLocationForJsonPath(['info', 'title'])
    expect(loc?.range.start.line).toBe(2)
  })

  it('reports syntax errors', () => {
    const { diagnostics } = parseJson('{ "a": }')
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})

describe('detectFormat / parseWithPointers', () => {
  it('detects json vs yaml', () => {
    expect(detectFormat('{"a":1}')).toBe('json')
    expect(detectFormat('a: 1')).toBe('yaml')
  })

  it('dispatches by detected format', () => {
    const { data } = parseWithPointers<{ a: number }>('{"a":1}')
    expect(data.a).toBe(1)
  })
})
