import { describe, expect, it } from 'vitest'

import { DiagnosticSeverity, detectFormat, parseJson, parseWithPointers, parseYaml } from './index'

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

  // M7: the configured severity must actually be applied to the duplicate-key
  // diagnostic, not ignored in favor of a hard error.
  it('reports duplicate keys at the configured severity', () => {
    const { diagnostics } = parseYaml('a: 1\na: 2\n', { duplicateKeys: DiagnosticSeverity.Warning })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe(DiagnosticSeverity.Warning)
  })

  // L1: a null map key used to render as `''` and collide with the root path;
  // distinct paths must now resolve to distinct locations.
  it('does not collide a null map key with the document root', () => {
    const { data, getLocationForJsonPath } = parseYaml<Record<string, unknown>>('null: 1\nother: 2\n')
    expect(data).toEqual({ null: 1, other: 2 })
    const rootStart = getLocationForJsonPath([])?.range.start
    const nullKeyStart = getLocationForJsonPath(['null'])?.range.start
    expect(rootStart).toEqual({ line: 0, character: 0 })
    expect(nullKeyStart).toEqual({ line: 0, character: 6 })
    expect(nullKeyStart).not.toEqual(rootStart)
  })

  it('locates a numeric-looking map key', () => {
    const { data, getLocationForJsonPath } = parseYaml('200: ok\n')
    expect(data).toEqual({ 200: 'ok' })
    expect(getLocationForJsonPath(['200'])?.range.start).toEqual({ line: 0, character: 5 })
  })

  // Precision gap 1: complex (map/seq) keys used to collapse to `''`, so two
  // distinct complex keys shared one index slot and clobbered each other's
  // ranges. Distinct complex keys must now resolve to distinct locations.
  it('does not collide two distinct complex mapping keys', () => {
    const source = ['? [a]', ': first', '? [b]', ': second'].join('\n') + '\n'
    const { getLocationForJsonPath } = parseYaml(source)
    // A sequence key `[a]` serializes to the stable segment `["a"]`.
    const locA = getLocationForJsonPath(['["a"]'])
    const locB = getLocationForJsonPath(['["b"]'])
    expect(locA?.range.start.line).toBe(1) // `: first`
    expect(locB?.range.start.line).toBe(3) // `: second`
    expect(locA?.range).not.toEqual(locB?.range)
  })

  it('gives a map key and a seq key distinct index slots', () => {
    // Both keys still collapse to `''` in the projected data (that is `toJS`'s
    // behavior), but the position index keeps them addressable and distinct.
    const source = ['? {a}', ': mapKey', '? [a]', ': seqKey'].join('\n') + '\n'
    const { data, getLocationForJsonPath } = parseYaml<Record<string, unknown>>(source)
    expect(data).toEqual({ '': 'seqKey' })
    const mapLoc = getLocationForJsonPath(['{"a":null}'])
    const seqLoc = getLocationForJsonPath(['["a"]'])
    expect(mapLoc?.range.start.line).toBe(1)
    expect(seqLoc?.range.start.line).toBe(3)
    expect(mapLoc?.range).not.toEqual(seqLoc?.range)
  })

  // Precision gap 2: subtrees reachable only through a `*alias` were never
  // indexed, so a finding on one fell back to the nearest ancestor. The path must
  // now resolve to the anchored node itself.
  it('indexes paths reached only through an alias', () => {
    const source = ['anchor: &a', '  x: 1', 'ref: *a'].join('\n') + '\n'
    const { data, getLocationForJsonPath } = parseYaml<Record<string, unknown>>(source)
    expect(data).toEqual({ anchor: { x: 1 }, ref: { x: 1 } })
    // The alias's own path points at the alias node (`*a` on line 2).
    expect(getLocationForJsonPath(['ref'])?.range.start.line).toBe(2)
    // A path reached only through the alias resolves to the anchored `x: 1`
    // (line 1), not a closest-ancestor fallback to the alias node.
    const exact = getLocationForJsonPath(['ref', 'x'])
    expect(exact).toBeDefined()
    expect(exact?.range.start.line).toBe(1)
    // Without the fix this would fall back to the alias node's line.
    expect(exact?.range.start.line).not.toBe(getLocationForJsonPath(['ref'])?.range.start.line)
  })

  it('indexes keys folded in through a `<<` merge', () => {
    const source = ['base: &b', '  a: 1', '  b: 2', 'derived:', '  <<: *b', '  c: 3'].join('\n') + '\n'
    const { data, getLocationForJsonPath } = parseYaml<Record<string, unknown>>(source)
    expect(data).toEqual({ base: { a: 1, b: 2 }, derived: { a: 1, b: 2, c: 3 } })
    // A merged key resolves to the anchored source node (`a: 1` on line 1).
    const merged = getLocationForJsonPath(['derived', 'a'])
    expect(merged?.range.start.line).toBe(1)
    // An explicit key of the same map keeps its own position (`c: 3` on line 5).
    expect(getLocationForJsonPath(['derived', 'c'])?.range.start.line).toBe(5)
    // `<<` is not a real projected key, so it is not indexed as one.
    expect(getLocationForJsonPath(['derived', '<<'])).toBeUndefined()
  })

  it('lets an explicit key win over a merged key of the same name', () => {
    const source = ['base: &b', '  a: 1', 'derived:', '  a: 99', '  <<: *b'].join('\n') + '\n'
    const { data, getLocationForJsonPath } = parseYaml<Record<string, unknown>>(source)
    expect(data).toEqual({ base: { a: 1 }, derived: { a: 99 } })
    // The explicit `a: 99` (line 3) wins over the merged `a`, matching `toJS`.
    expect(getLocationForJsonPath(['derived', 'a'])?.range.start.line).toBe(3)
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
