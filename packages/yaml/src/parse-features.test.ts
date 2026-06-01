import { describe, expect, it } from 'vitest'

import { parseAllDocuments, parseDocument } from './parse-document'

describe('core-schema tags', () => {
  it('forces a number to a string with !!str (keeping the raw text)', () => {
    expect(parseDocument('a: !!str 123\n').toJS()).toEqual({ a: '123' })
    expect(parseDocument('a: !!str true\n').toJS()).toEqual({ a: 'true' })
    // The plain source is preserved verbatim, so a trailing zero survives.
    expect(parseDocument('a: !!str 1.50\n').toJS()).toEqual({ a: '1.50' })
  })

  it('parses a quoted string to a number with !!int', () => {
    expect(parseDocument('a: !!int "42"\n').toJS()).toEqual({ a: 42 })
  })

  it('resolves !!float, !!null, and !!bool per the core schema', () => {
    expect(parseDocument('a: !!float 3\n').toJS()).toEqual({ a: 3 })
    expect(parseDocument('a: !!null anything\n').toJS()).toEqual({ a: null })
    expect(parseDocument('a: !!bool false\n').toJS()).toEqual({ a: false })
  })

  it('leaves the value untouched for an unknown/custom tag but keeps the tag on the node', () => {
    const doc = parseDocument('a: !custom hello\n')
    expect(doc.toJS()).toEqual({ a: 'hello' })
    const node = doc.contents
    if (node?.kind === 'map') {
      const value = node.items[0]?.value
      if (value?.kind === 'scalar') expect(value.tag).toBe('custom')
    }
  })
})

describe('multi-document streams', () => {
  it('parses each --- separated document', () => {
    const docs = parseAllDocuments('a: 1\n---\nb: 2\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('treats a ... end marker as a document boundary', () => {
    const docs = parseAllDocuments('a: 1\n...\nb: 2\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('yields an explicit empty document for a trailing ---', () => {
    const docs = parseAllDocuments('a: 1\n---\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, null])
  })

  it('separates top-level scalar documents', () => {
    expect(parseAllDocuments('foo\n---\nbar\n').map((d) => d.toJS())).toEqual(['foo', 'bar'])
  })

  it('honors directives between documents', () => {
    const docs = parseAllDocuments('%YAML 1.2\n---\na: 1\n---\nb: 2\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('gives each document its own anchors and errors', () => {
    // The `*x` alias in the second document must NOT resolve the first document's
    // anchor — anchor scope is per document.
    const docs = parseAllDocuments('first: &x 1\n---\nsecond: *x\n')
    expect(docs[0]?.toJS()).toEqual({ first: 1 })
    expect(docs[1]?.toJS()).toEqual({ second: undefined })
  })

  it('returns an empty array for an empty stream', () => {
    expect(parseAllDocuments('')).toEqual([])
    expect(parseAllDocuments('   \n# comment\n')).toEqual([])
  })

  it('reports a duplicate-key error against the document it occurs in', () => {
    const docs = parseAllDocuments('a: 1\n---\nb: 1\nb: 2\n')
    expect(docs[0]?.errors).toHaveLength(0)
    expect(docs[1]?.errors.map((e) => e.code)).toEqual(['DUPLICATE_KEY'])
  })

  it('still exposes only the first document through parseDocument', () => {
    expect(parseDocument('a: 1\n---\nb: 2\n').toJS()).toEqual({ a: 1 })
  })
})

describe('explicit ? / : mapping entries', () => {
  it('parses explicit scalar keys and values', () => {
    expect(parseDocument('? a\n: 1\n? b\n: 2\n').toJS()).toEqual({ a: 1, b: 2 })
  })

  it('treats an explicit key with no : line as a null value', () => {
    expect(parseDocument('? a\n? b\n').toJS()).toEqual({ a: null, b: null })
  })

  it('parses a block value under an explicit key', () => {
    expect(parseDocument('? a\n:\n  x: 1\n  y: 2\n').toJS()).toEqual({ a: { x: 1, y: 2 } })
  })

  it('mixes explicit and implicit entries in one mapping', () => {
    expect(parseDocument('? a\n: 1\nb: 2\n').toJS()).toEqual({ a: 1, b: 2 })
  })

  it('keeps a plain scalar that merely starts with ? as an implicit key', () => {
    // No space after `?`, so this is an ordinary key, not an explicit introducer.
    expect(parseDocument('?key: value\n').toJS()).toEqual({ '?key': 'value' })
  })

  it('records the source range of an explicit key node', () => {
    const node = parseDocument('? name\n: value\n').contents
    if (node?.kind === 'map') {
      const key = node.items[0]?.key
      // `name` begins at offset 2 (just past `? `) and ends before the newline.
      expect([key?.start, key?.end]).toEqual([2, 6])
    }
  })

  it('does not over-report duplicates for distinct complex keys', () => {
    // Two different flow-sequence keys both project to "" in plain JS, but must
    // not be flagged as duplicate keys.
    const { errors } = parseDocument('? [a]\n: 1\n? [b]\n: 2\n')
    expect(errors).toHaveLength(0)
  })
})
