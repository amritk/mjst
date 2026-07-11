import { describe, expect, it } from 'vitest'

import { applyEditOps, applyEditOpsWithChanges, type EditOp } from './edit-model'
import { parseWithPointers } from './index'

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

  // H1: jsonc-parser's `modify` inserts a missing path (and its ancestor chain);
  // the contract is that an unresolved path is a no-op, so the guard must drop it.
  it('does not create a missing JSON path on setValue', () => {
    expect(apply('{"a": 1}', 'json', { op: 'setValue', path: ['x', 'y'], value: 2 })).toBe('{"a": 1}')
  })

  it('does not touch a missing JSON path on removeProperty', () => {
    expect(apply('{"a": 1}', 'json', { op: 'removeProperty', path: ['x'] })).toBe('{"a": 1}')
  })

  // H2: a compact sequence-entry map keeps its `- ` dash when a member is removed,
  // so the item does not collapse into a bare mapping on the next parse.
  it('removes the first pair of a compact seq-item map without swallowing the dash', () => {
    const source = 'items:\n  - a: 1\n    b: 2\n'
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['items', 0, 'a'] })).toBe('items:\n  - b: 2\n')
  })

  it('removes a later pair of a compact seq-item map by dropping its own line', () => {
    const source = 'items:\n  - a: 1\n    b: 2\n'
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['items', 0, 'b'] })).toBe('items:\n  - a: 1\n')
  })

  it('removes a $ref sibling on a compact seq-item map (no-$ref-siblings shape)', () => {
    const source = 'allOf:\n  - $ref: "#/x"\n    description: gone\n'
    expect(apply(source, 'yaml', { op: 'removeProperty', path: ['allOf', 0, 'description'] })).toBe(
      'allOf:\n  - $ref: "#/x"\n',
    )
  })

  // H3: an inserted property on a compact seq-item map must indent to the key's
  // column, not the line indent, or it lands outside the item and vanishes.
  it('inserts a property into a compact seq-item map at the key column', () => {
    const source = 'tags:\n  - name: a\n'
    const result = apply(source, 'yaml', { op: 'insertProperty', path: ['tags', 0], key: 'description', value: 'x' })
    expect(result).toBe('tags:\n  - name: a\n    description: "x"\n')
    // The inserted property survives a re-parse as part of the item, not a sibling.
    expect((parseWithPointers(result).data as { tags: unknown[] }).tags).toEqual([{ name: 'a', description: 'x' }])
  })

  // M1: a plain scalar replacement must not silently change type or corrupt the line.
  it('quotes a string value that would otherwise read as a non-string', () => {
    expect(apply('a: hi\n', 'yaml', { op: 'setValue', path: ['a'], value: 'true' })).toBe('a: "true"\n')
    expect(apply('a: hi\n', 'yaml', { op: 'setValue', path: ['a'], value: '' })).toBe('a: ""\n')
    expect(apply('a: hi\n', 'yaml', { op: 'setValue', path: ['a'], value: 'x: y' })).toBe('a: "x: y"\n')
    expect(apply('a: hi\n', 'yaml', { op: 'setValue', path: ['a'], value: 'a\nb' })).toBe('a: "a\\nb"\n')
  })

  it('keeps a plain string bare when it round-trips unchanged', () => {
    expect(apply('a: hi\n', 'yaml', { op: 'setValue', path: ['a'], value: 'bye' })).toBe('a: bye\n')
  })

  it('quotes a renamed key that would resolve to a non-string', () => {
    expect(apply('a: 1\n', 'yaml', { op: 'renameProperty', path: ['a'], newKey: 'true' })).toBe('"true": 1\n')
  })

  // M2: duplicate keys are last-wins to match toJS and the position index, so an
  // edit must land on the final occurrence, not the shadowed first one.
  it('edits the last of duplicate keys', () => {
    expect(apply('a: 1\na: 2\n', 'yaml', { op: 'setValue', path: ['a'], value: 9 })).toBe('a: 1\na: 9\n')
    expect(apply('a: 1\na: 2\n', 'yaml', { op: 'removeProperty', path: ['a'] })).toBe('a: 1\n')
  })

  // M4: a nested block sequence starting on the parent dash line must indent from
  // the inner item's own dash, or the new item joins the outer sequence.
  it('inserts into a nested block sequence at the inner indentation', () => {
    const source = 'matrix:\n  - - 1\n    - 2\n'
    const result = apply(source, 'yaml', { op: 'insertItem', path: ['matrix', 0], value: 3 })
    expect(result).toBe('matrix:\n  - - 1\n    - 2\n    - 3\n')
    expect((parseWithPointers(result).data as { matrix: unknown[] }).matrix).toEqual([[1, 2, 3]])
  })

  // M5: a rename whose path ends in an array index has an `array` parent, not a
  // `property`, and must be refused rather than overwriting element 0.
  it('refuses to rename a JSON array index', () => {
    expect(apply('{"a": [10, 20]}', 'json', { op: 'renameProperty', path: ['a', 0], newKey: 'x' })).toBe(
      '{"a": [10, 20]}',
    )
  })

  // M6: JSON array edits slice original element text so numbers, Unicode, and
  // one-line layout survive instead of being re-serialized.
  it('preserves element formatting when removing from a JSON array', () => {
    expect(apply('{"n": [1.50, 2.00, 1.50]}', 'json', { op: 'removeItems', path: ['n'], indices: [2] })).toBe(
      '{"n": [1.50, 2.00]}',
    )
  })

  it('preserves Unicode and layout when reordering a JSON array', () => {
    expect(apply('{"s": ["é", "x"]}', 'json', { op: 'reorderArray', path: ['s'], order: [1, 0] })).toBe(
      '{"s": ["x", "é"]}',
    )
  })

  it('keeps a multi-line JSON array multi-line when removing an element', () => {
    const source = '{\n  "n": [\n    1,\n    2,\n    3\n  ]\n}'
    expect(apply(source, 'json', { op: 'removeItems', path: ['n'], indices: [1] })).toBe(
      '{\n  "n": [\n    1,\n    3\n  ]\n}',
    )
  })

  // L2: inserted lines must use the file's own line ending, not a bare LF.
  it('uses CRLF for inserted lines in a CRLF document', () => {
    expect(apply('a: 1\r\nb: 2\r\n', 'yaml', { op: 'insertProperty', path: [], key: 'c', value: 3 })).toBe(
      'a: 1\r\nb: 2\r\nc: 3\r\n',
    )
  })

  it('uses CRLF for JSON edits in a CRLF document', () => {
    const source = '{\r\n  "a": 1\r\n}'
    const result = apply(source, 'json', { op: 'insertProperty', path: [], key: 'b', value: 2 })
    expect(result).toBe('{\r\n  "a": 1,\r\n  "b": 2\r\n}')
  })

  // L4: an explicit-empty key (`foo:` with a null value) is editable, not a no-op.
  it('sets a value on an explicit-empty key', () => {
    expect(apply('foo:\n', 'yaml', { op: 'setValue', path: ['foo'], value: 'bar' })).toBe('foo: bar\n')
  })

  it('inserts a property under an explicit-empty key', () => {
    expect(apply('foo:\n', 'yaml', { op: 'insertProperty', path: ['foo'], key: 'k', value: 'v' })).toBe(
      'foo:\n  k: "v"\n',
    )
  })

  // L5: edits that traverse an alias or a merge key are safe no-ops.
  it('leaves the source untouched for an edit through an alias', () => {
    const source = 'base: &b\n  x: 1\nderived: *b\n'
    expect(apply(source, 'yaml', { op: 'setValue', path: ['derived', 'x'], value: 2 })).toBe(source)
  })

  it('leaves the source untouched for an edit through a merge key', () => {
    const source = 'base: &b\n  x: 1\nderived:\n  <<: *b\n'
    expect(apply(source, 'yaml', { op: 'setValue', path: ['derived', 'x'], value: 2 })).toBe(source)
  })

  // Block scalars must not be corrupted: a simple value collapses onto the line,
  // a value with a newline is quoted rather than breaking the block.
  it('replaces a block-literal scalar value', () => {
    const source = 'desc: |\n  line one\n  line two\n'
    expect(apply(source, 'yaml', { op: 'setValue', path: ['desc'], value: 'new' })).toBe('desc: new\n')
    expect(apply(source, 'yaml', { op: 'setValue', path: ['desc'], value: 'a\nb' })).toBe('desc: "a\\nb"\n')
  })

  // M3: comments between block-sequence items travel with the item they precede.
  it('keeps comments between sequence items when reordering', () => {
    const source = 'seq:\n  - a\n  # note b\n  - b\n  - c\n'
    expect(apply(source, 'yaml', { op: 'reorderArray', path: ['seq'], order: [2, 1, 0] })).toBe(
      'seq:\n  - c\n  # note b\n  - b\n  - a\n',
    )
  })

  it('keeps unrelated comments when removing a sequence item', () => {
    const source = 'seq:\n  - a\n  # note b\n  - b\n  - c\n'
    expect(apply(source, 'yaml', { op: 'removeItems', path: ['seq'], indices: [0] })).toBe(
      'seq:\n  # note b\n  - b\n  - c\n',
    )
  })
})
