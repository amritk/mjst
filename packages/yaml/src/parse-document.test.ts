import { describe, expect, it } from 'vitest'

import { parseDocument } from './parse-document'

describe('parse-document', () => {
  it('parses a block mapping', () => {
    expect(parseDocument('a: 1\nb: 2\n').toJS()).toEqual({ a: 1, b: 2 })
  })

  it('parses nested block mappings', () => {
    expect(parseDocument('a:\n  b:\n    c: 1\n  d: 2\n').toJS()).toEqual({ a: { b: { c: 1 }, d: 2 } })
  })

  it('parses a block sequence', () => {
    expect(parseDocument('- one\n- two\n').toJS()).toEqual(['one', 'two'])
  })

  it('parses a sequence indented to its parent key', () => {
    expect(parseDocument('items:\n- 1\n- 2\n').toJS()).toEqual({ items: [1, 2] })
  })

  it('parses a mapping nested in a sequence entry', () => {
    expect(parseDocument('- name: a\n  age: 1\n- name: b\n  age: 2\n').toJS()).toEqual([
      { name: 'a', age: 1 },
      { name: 'b', age: 2 },
    ])
  })

  it('treats a key with no value as null', () => {
    expect(parseDocument('a:\nb: 1\n').toJS()).toEqual({ a: null, b: 1 })
  })

  it('parses flow sequences and mappings, including nesting', () => {
    expect(parseDocument('a: [1, 2, {x: y, z: 3}]\n').toJS()).toEqual({ a: [1, 2, { x: 'y', z: 3 }] })
  })

  it('parses a flow collection that spans multiple lines', () => {
    expect(parseDocument('a: [\n  1,\n  2,\n]\n').toJS()).toEqual({ a: [1, 2] })
  })

  it('parses single- and double-quoted scalars', () => {
    expect(parseDocument(`a: 'it''s here'\nb: "tab\\tend"\n`).toJS()).toEqual({ a: "it's here", b: 'tab\tend' })
  })

  it('does not treat a colon inside a URL as a mapping separator', () => {
    expect(parseDocument('url: https://example.com/path\n').toJS()).toEqual({ url: 'https://example.com/path' })
  })

  it('parses a literal block scalar and clips the trailing newline', () => {
    expect(parseDocument('text: |\n  line1\n  line2\n').toJS()).toEqual({ text: 'line1\nline2\n' })
  })

  it('strips the trailing newline with the `-` chomping indicator', () => {
    expect(parseDocument('text: |-\n  line1\n  line2\n').toJS()).toEqual({ text: 'line1\nline2' })
  })

  it('keeps trailing newlines with the `+` chomping indicator', () => {
    expect(parseDocument('text: |+\n  line1\n\n\nnext: 1\n').toJS()).toEqual({ text: 'line1\n\n\n', next: 1 })
  })

  it('folds a folded block scalar', () => {
    expect(parseDocument('text: >\n  one\n  two\n').toJS()).toEqual({ text: 'one two\n' })
  })

  it('ignores full-line and inline comments', () => {
    const source = '# header\na: 1 # trailing\n# between\nb: 2\n'
    expect(parseDocument(source).toJS()).toEqual({ a: 1, b: 2 })
  })

  it('resolves anchors and aliases', () => {
    expect(parseDocument('base: &b\n  x: 1\nuse: *b\n').toJS()).toEqual({ base: { x: 1 }, use: { x: 1 } })
  })

  it('applies merge keys without overriding explicit keys', () => {
    const source = 'defaults: &d\n  timeout: 30\n  retries: 3\nservice:\n  <<: *d\n  retries: 5\n'
    expect(parseDocument(source).toJS()).toEqual({
      defaults: { timeout: 30, retries: 3 },
      service: { timeout: 30, retries: 5 },
    })
  })

  it('reports a duplicate key as an error with its range', () => {
    const { errors } = parseDocument('a: 1\na: 2\n')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('DUPLICATE_KEY')
    expect(errors[0]?.kind).toBe('error')
    // The error points at the second `a`, which starts at offset 5.
    expect(errors[0]?.pos[0]).toBe(5)
  })

  it('keeps the last value for a duplicate key but still flags it', () => {
    expect(parseDocument('a: 1\na: 2\n').toJS()).toEqual({ a: 2 })
  })

  it('allows duplicate keys when uniqueKeys is disabled', () => {
    const { errors, toJS } = parseDocument('a: 1\na: 2\n', { uniqueKeys: false })
    expect(errors).toHaveLength(0)
    expect(toJS()).toEqual({ a: 2 })
  })

  it('records an error for an unterminated flow collection', () => {
    const { errors } = parseDocument('a: [1, 2\n')
    expect(errors.some((e) => e.code === 'UNTERMINATED_FLOW')).toBe(true)
  })

  it('skips a document-start marker and directives', () => {
    expect(parseDocument('%YAML 1.2\n---\na: 1\n').toJS()).toEqual({ a: 1 })
  })

  it('stops at a document-end marker', () => {
    expect(parseDocument('a: 1\n...\n').toJS()).toEqual({ a: 1 })
  })

  it('returns null contents for an empty document', () => {
    expect(parseDocument('').contents).toBeNull()
    expect(parseDocument('   \n  \n').contents).toBeNull()
  })

  it('records the source range of a scalar value', () => {
    const source = 'title: My API'
    const node = parseDocument(source).contents
    if (node?.kind === 'map') {
      const value = node.items[0]?.value
      // "My API" starts at offset 7 and ends (exclusive) at 13.
      expect(value?.range).toEqual([7, 13])
    }
  })

  it('starts a block map range at its first key', () => {
    const source = 'info:\n  title: a\n  version: b\n'
    const node = parseDocument(source).contents
    if (node?.kind === 'map') {
      const info = node.items[0]?.value
      // The nested map begins at `title`, the first child key (offset 8).
      expect(info?.range[0]).toBe(8)
    }
  })

  it('exposes anchors on the nodes that declare them', () => {
    const node = parseDocument('a: &myAnchor 1\n').contents
    if (node?.kind === 'map') {
      const value = node.items[0]?.value
      if (value?.kind === 'scalar') expect(value.anchor).toBe('myAnchor')
    }
  })
})
