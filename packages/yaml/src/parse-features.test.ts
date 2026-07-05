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

describe('extended !! tags', () => {
  it('decodes !!binary to bytes', () => {
    const value = parseDocument('a: !!binary "aGVsbG8="\n').toJS() as { a: Uint8Array }
    expect(value.a).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(value.a)).toBe('hello')
  })

  it('decodes multi-line !!binary, stripping the wrapping whitespace', () => {
    const value = parseDocument('a: !!binary |\n  aGVsbG8g\n  d29ybGQ=\n').toJS() as { a: Uint8Array }
    expect(new TextDecoder().decode(value.a)).toBe('hello world')
  })

  it('parses !!timestamp to a Date', () => {
    const value = parseDocument('a: !!timestamp 2020-01-02T03:04:05Z\n').toJS() as { a: Date }
    expect(value.a).toBeInstanceOf(Date)
    expect(value.a.toISOString()).toBe('2020-01-02T03:04:05.000Z')
  })

  it('builds a Set from !!set', () => {
    const value = parseDocument('a: !!set { x, y, z }\n').toJS() as { a: Set<unknown> }
    expect(value.a).toBeInstanceOf(Set)
    expect([...value.a]).toEqual(['x', 'y', 'z'])
  })

  it('builds an ordered Map from !!omap', () => {
    const value = parseDocument('a: !!omap [ x: 1, y: 2 ]\n').toJS() as { a: Map<unknown, unknown> }
    expect(value.a).toBeInstanceOf(Map)
    expect([...value.a]).toEqual([
      ['x', 1],
      ['y', 2],
    ])
  })

  it('keeps the raw value when an extended tag cannot resolve', () => {
    expect(parseDocument('a: !!timestamp not-a-date\n').toJS()).toEqual({ a: 'not-a-date' })
  })
})

describe('tab indentation', () => {
  it('reports a tab used for indentation', () => {
    const doc = parseDocument('a:\n\tb: 1\n')
    expect(doc.errors.map((e) => e.code)).toContain('TAB_INDENT')
  })

  it('points the error span at the offending tab', () => {
    const doc = parseDocument('a:\n\tb: 1\n')
    const tab = doc.errors.find((e) => e.code === 'TAB_INDENT')
    // The tab is the third character (after `a:\n`).
    expect([tab?.start, tab?.end]).toEqual([3, 4])
  })

  it('does not flag a tab used to separate a key from its value', () => {
    const doc = parseDocument('a:\tvalue\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ a: 'value' })
  })

  it('reports each tab-indented line once, not once per peek', () => {
    const doc = parseDocument('a:\n\tb: 1\n\tc: 2\n')
    // Two distinct offending lines → exactly two errors, never doubled by a
    // child-then-parent re-peek of the same line.
    expect(doc.errors.filter((e) => e.code === 'TAB_INDENT')).toHaveLength(2)
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

describe('resource-exhaustion guards', () => {
  it('rejects alias-expansion (billion laughs) instead of hanging', () => {
    // ~500-byte document whose aliases expand to ~10^10 nodes.
    let src = 'a0: &a0 ["x","x","x","x","x","x","x","x","x","x"]\n'
    for (let i = 1; i <= 10; i++) {
      const prev = Array.from({ length: 10 }, () => `*a${i - 1}`).join(',')
      src += `a${i}: &a${i} [${prev}]\n`
    }
    src += 'b: *a10\n'
    const doc = parseDocument(src)
    expect(() => doc.toJS()).toThrow(/alias expansion/i)
  })

  it('still expands reasonable alias use correctly', () => {
    const out = parseDocument('base: &b { x: 1 }\nc: *b\nd: *b\n').toJS() as {
      c: { x: number }
      d: { x: number }
    }
    expect(out.c.x).toBe(1)
    expect(out.d.x).toBe(1)
  })

  it('reports a depth-limit error on pathologically nested flow input instead of overflowing', () => {
    const { errors } = parseDocument('['.repeat(100_000))
    expect(errors.some((e) => e.code === 'DEPTH_LIMIT')).toBe(true)
  })

  it('reports a depth-limit error on pathologically nested block input instead of overflowing', () => {
    const { errors } = parseDocument('- '.repeat(60_000))
    expect(errors.some((e) => e.code === 'DEPTH_LIMIT')).toBe(true)
  })

  it('parses legitimately deep (but bounded) nesting without error', () => {
    const { errors } = parseDocument('['.repeat(200) + ']'.repeat(200))
    expect(errors.some((e) => e.code === 'DEPTH_LIMIT')).toBe(false)
  })

  it('does not let a __proto__ mapping key pollute the projected object', () => {
    const out = parseDocument('__proto__: { polluted: true }\nsafe: 1\n').toJS() as {
      safe: number
    }
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    expect(out.safe).toBe(1)
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ polluted: true })
  })
})
