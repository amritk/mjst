import { describe, expect, it } from 'vitest'

import { applyEditOps, applyEditOpsWithChanges, type EditOp } from './edit-model'

const apply = (source: string, format: 'yaml' | 'json', ...ops: EditOp[]): string => applyEditOps(source, format, ops)

describe('edit-model', () => {
  it('replaces a scalar value while preserving surrounding formatting', () => {
    const source = 'info:\n  title: Old # keep me\n  version: "1.0"\n'
    const result = apply(source, 'yaml', { op: 'setValue', path: ['info', 'title'], value: 'New' })
    expect(result).toBe('info:\n  title: New # keep me\n  version: "1.0"\n')
  })

  it('preserves double quotes when replacing a quoted value', () => {
    const source = 'host: "api.example.com/"\n'
    const result = apply(source, 'yaml', { op: 'setValue', path: ['host'], value: 'api.example.com' })
    expect(result).toBe('host: "api.example.com"\n')
  })

  it('renames an object key, keeping its value untouched', () => {
    const source = 'paths:\n  /foo/:\n    get: {}\n'
    const result = apply(source, 'yaml', { op: 'renameProperty', path: ['paths', '/foo/'], newKey: '/foo' })
    expect(result).toBe('paths:\n  /foo:\n    get: {}\n')
  })

  it('removes an object property and its whole line', () => {
    const source = 'a:\n  $ref: "#/x"\n  description: gone\n  nullable: true\n'
    const result = apply(
      source,
      'yaml',
      { op: 'removeProperty', path: ['a', 'description'] },
      { op: 'removeProperty', path: ['a', 'nullable'] },
    )
    expect(result).toBe('a:\n  $ref: "#/x"\n')
  })

  it('removes a member from a flow map, keeping the others on the line', () => {
    const source = 'info: { title: API, version: x, note: hi }\n'
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['info', 'title'] })).toBe(
      'info: { version: x, note: hi }\n',
    )
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['info', 'version'] })).toBe(
      'info: { title: API, note: hi }\n',
    )
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['info', 'note'] })).toBe(
      'info: { title: API, version: x }\n',
    )
  })

  it('empties a flow map when its only member is removed', () => {
    const source = 'info: { title: API }\n'
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['info', 'title'] })).toBe('info: {}\n')
  })

  it('dedupes a block sequence by removing the given indices', () => {
    const source = 'enum:\n  - a\n  - b\n  - a\n  - c\n'
    const result = apply(source, 'yaml', { op: 'removeItems', path: ['enum'], indices: [2] })
    expect(result).toBe('enum:\n  - a\n  - b\n  - c\n')
  })

  it('dedupes a flow sequence in place', () => {
    const source = 'enum: [red, green, red, blue]\n'
    const result = apply(source, 'yaml', { op: 'removeItems', path: ['enum'], indices: [2] })
    expect(result).toBe('enum: [red, green, blue]\n')
  })

  it('reorders a block sequence, preserving each item block', () => {
    const source = 'tags:\n  - name: zebra\n  - name: apple\n'
    const result = apply(source, 'yaml', { op: 'reorderArray', path: ['tags'], order: [1, 0] })
    expect(result).toBe('tags:\n  - name: apple\n  - name: zebra\n')
  })

  it('skips an op whose path does not resolve', () => {
    const source = 'a: 1\n'
    const result = apply(source, 'yaml', { op: 'setValue', path: ['missing'], value: 2 })
    expect(result).toBe(source)
  })

  it('edits JSON via minimal structural edits', () => {
    const source = '{\n  "servers": [ { "url": "https://x/" } ],\n  "x": { "$ref": "#/c", "description": "d" }\n}'
    const stripped = apply(source, 'json', { op: 'setValue', path: ['servers', 0, 'url'], value: 'https://x' })
    expect(JSON.parse(stripped).servers[0].url).toBe('https://x')
    const removed = apply(source, 'json', { op: 'removeProperty', path: ['x', 'description'] })
    expect(Object.keys(JSON.parse(removed).x)).toEqual(['$ref'])
  })

  it('reorders and dedupes JSON arrays', () => {
    const source = '{ "tags": [ { "name": "z" }, { "name": "a" } ], "enum": ["a", "b", "a"] }'
    const reordered = apply(source, 'json', { op: 'reorderArray', path: ['tags'], order: [1, 0] })
    expect(JSON.parse(reordered).tags).toEqual([{ name: 'a' }, { name: 'z' }])
    const deduped = apply(source, 'json', { op: 'removeItems', path: ['enum'], indices: [2] })
    expect(JSON.parse(deduped).enum).toEqual(['a', 'b'])
  })

  it('inserts a property into a block map at the existing indentation', () => {
    const source = 'info:\n  title: API\n  version: "1.0"\n'
    const result = apply(source, 'yaml', { op: 'insertProperty', path: ['info'], key: 'description', value: 'Hi' })
    expect(result).toBe('info:\n  title: API\n  version: "1.0"\n  description: "Hi"\n')
  })

  it('inserts a property into a flow map', () => {
    const source = 'info: { title: API }\n'
    const result = apply(source, 'yaml', { op: 'insertProperty', path: ['info'], key: 'version', value: '1.0' })
    expect(result).toBe('info: { title: API, version: "1.0" }\n')
  })

  it('leaves an existing property untouched when inserting', () => {
    const source = 'info:\n  title: API\n'
    const result = apply(source, 'yaml', { op: 'insertProperty', path: ['info'], key: 'title', value: 'Other' })
    expect(result).toBe(source)
  })

  it('appends an item to a block sequence, mirroring its style', () => {
    const source = 'tags:\n  - name: a\n  - name: b\n'
    const result = apply(source, 'yaml', { op: 'insertItem', path: ['tags'], value: { name: 'c' } })
    expect(result).toBe('tags:\n  - name: a\n  - name: b\n  - {"name":"c"}\n')
  })

  it('inserts an item into a flow sequence at an index', () => {
    const source = 'enum: [red, blue]\n'
    const result = apply(source, 'yaml', { op: 'insertItem', path: ['enum'], value: 'green', index: 1 })
    expect(result).toBe('enum: [red, "green", blue]\n')
  })

  it('inserts properties and items into JSON', () => {
    const source = '{\n  "info": { "title": "API" },\n  "tags": ["a", "b"]\n}'
    const withProp = apply(source, 'json', { op: 'insertProperty', path: ['info'], key: 'version', value: '1.0' })
    expect(JSON.parse(withProp).info).toEqual({ title: 'API', version: '1.0' })
    const withItem = apply(source, 'json', { op: 'insertItem', path: ['tags'], value: 'c', index: 1 })
    expect(JSON.parse(withItem).tags).toEqual(['a', 'c', 'b'])
  })

  it('reports which ops changed the text', () => {
    const source = 'a: 1\n'
    const result = applyEditOpsWithChanges(source, 'yaml', [
      { op: 'setValue', path: ['a'], value: 2 },
      { op: 'setValue', path: ['missing'], value: 3 },
    ])
    expect(result.output).toBe('a: 2\n')
    expect(result.changed).toEqual([true, false])
  })
})
