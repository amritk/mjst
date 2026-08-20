import { describe, expect, it } from 'vitest'

import { keyText, parseAllDocuments, parseDocument } from './parse-document'
import type { YamlAlias, YamlNode } from './types'

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
    expect(tagOfFirstValue(doc)).toBe('!custom')
  })

  it('keeps a local tag distinct from the core tag of the same name, so it does not coerce', () => {
    // `!str` names an application-local type; only `!!str` is the core schema's.
    expect(parseDocument('a: !str 123\n').toJS()).toEqual({ a: 123 })
    expect(tagOfFirstValue(parseDocument('a: !str 123\n'))).toBe('!str')
    expect(parseDocument('a: !!str 123\n').toJS()).toEqual({ a: '123' })
  })

  it('resolves a verbatim tag to the core tag it names', () => {
    expect(parseDocument('a: !<tag:yaml.org,2002:str> 123\n').toJS()).toEqual({ a: '123' })
    expect(tagOfFirstValue(parseDocument('a: !<tag:yaml.org,2002:str> 123\n'))).toBe('str')
  })

  it('keeps a verbatim tag outside the schema namespace whole', () => {
    const doc = parseDocument('a: !<https://example.com/t> 123\n')
    expect(tagOfFirstValue(doc)).toBe('https://example.com/t')
    expect(doc.toJS()).toEqual({ a: 123 })
  })

  it('reports a verbatim tag with no closing bracket', () => {
    const doc = parseDocument('a: !<tag:yaml.org,2002:str 1\n')
    expect(doc.errors.map((e) => e.code)).toContain('BAD_TAG')
  })

  it('resolves the non-specific ! tag as a string', () => {
    expect(parseDocument('a: ! 123\n').toJS()).toEqual({ a: '123' })
  })

  it('percent-decodes escapes in a tag suffix', () => {
    expect(tagOfFirstValue(parseDocument('a: !%21odd 1\n'))).toBe('!!odd')
  })
})

/** Reads the tag off the first mapping value — the shape every tag test asserts on. */
const tagOfFirstValue = (doc: ReturnType<typeof parseDocument>): string | undefined => {
  const node = doc.contents
  if (node?.kind !== 'map') return undefined
  return node.items[0]?.value?.kind === 'scalar' ? node.items[0]?.value.tag : undefined
}

describe('%TAG and %YAML directives', () => {
  it('expands a tag written through a declared handle', () => {
    const doc = parseDocument('%TAG !e! tag:example.com,2000:app/\n---\na: !e!foo 1\n')
    expect(tagOfFirstValue(doc)).toBe('tag:example.com,2000:app/foo')
  })

  it('lets %TAG redirect the !! handle onto the core schema namespace', () => {
    const doc = parseDocument('%TAG !! tag:example.com,2000:app/\n---\na: !!foo 1\n')
    expect(tagOfFirstValue(doc)).toBe('tag:example.com,2000:app/foo')
  })

  it('reports a handle that was never declared', () => {
    const doc = parseDocument('a: !e!foo 1\n')
    expect(doc.errors.map((e) => e.code)).toContain('UNKNOWN_TAG_HANDLE')
  })

  it('scopes tag handles to the document that declared them', () => {
    const [first, second] = parseAllDocuments(
      '%TAG !e! tag:example.com,2000:app/\n---\na: !e!foo 1\n---\nb: !e!foo 2\n',
    )
    expect(first?.errors ?? []).toHaveLength(0)
    expect((second?.errors ?? []).map((e) => e.code)).toContain('UNKNOWN_TAG_HANDLE')
  })

  it('warns that a 1.1 document is parsed with the 1.2 core schema', () => {
    const doc = parseDocument('%YAML 1.1\n---\na: yes\n')
    expect(doc.warnings.map((w) => w.code)).toEqual(['UNSUPPORTED_YAML_VERSION'])
    // The warning is advisory: resolution stays on the 1.2 core schema.
    expect(doc.toJS()).toEqual({ a: 'yes' })
  })

  it('does not warn about a %YAML 1.2 directive', () => {
    expect(parseDocument('%YAML 1.2\n---\na: 1\n').warnings).toHaveLength(0)
  })

  it('rejects a repeated %YAML directive but only warns about an unknown one', () => {
    // At most one %YAML directive is legal, so a second is an error rather than
    // advice; an unrecognised directive is reserved for future versions and the
    // spec says to ignore it with a warning.
    expect(parseDocument('%YAML 1.2\n%YAML 1.2\n---\na: 1\n').errors.map((e) => e.code)).toEqual([
      'DUPLICATE_DIRECTIVE',
    ])
    expect(parseDocument('%FOO bar\n---\na: 1\n').warnings.map((w) => w.code)).toEqual(['UNKNOWN_DIRECTIVE'])
  })

  it('rejects a %YAML directive whose version is malformed or trailed by content', () => {
    expect(parseDocument('%YAML 1.1#...\n---\na: 1\n').errors.map((e) => e.code)).toEqual(['BAD_DIRECTIVE'])
    expect(parseDocument('%YAML 1.2 foo\n---\na: 1\n').errors.map((e) => e.code)).toEqual(['BAD_DIRECTIVE'])
    // A trailing comment is not trailing content.
    expect(parseDocument('%YAML 1.2 # ok\n---\na: 1\n').errors).toHaveLength(0)
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

  it('takes the ? introducer over a later ": " on the same line', () => {
    // `? earth: blue` is an explicit key holding a mapping, not a key spelled
    // `? earth`.
    const doc = parseDocument('? earth: blue\n: 1\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ '{ earth: blue }': 1 })
  })
})

describe('block collections opened on an explicit key line', () => {
  it('parses a sequence whose first entry shares the ":" line', () => {
    expect(parseDocument('? a\n: - one\n  - two\n').toJS()).toEqual({ a: ['one', 'two'] })
  })

  it('parses a mapping whose first entry shares the "?" line', () => {
    expect(parseDocument('- ? earth: blue\n  : moon: white\n').toJS()).toEqual([
      { '{ earth: blue }': { moon: 'white' } },
    ])
  })

  it('sets the collection indent from the entry column, not the introducer', () => {
    // The nested `- c` / `- d` sequence opens at column 5 and its second entry
    // has to align there, not under the outer `-` at column 2.
    expect(parseDocument('? a\n: - b\n  -  - c\n     - d\n').toJS()).toEqual({ a: ['b', ['c', 'd']] })
  })

  it('reports the same shape after an implicit key, where it is invalid', () => {
    const doc = parseDocument('key: - a\n     - b\n')
    expect(doc.errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('still reads a "-" that is not an entry indicator as a scalar', () => {
    expect(parseDocument('key: -1\n').errors).toHaveLength(0)
    expect(parseDocument('key: -1\n').toJS()).toEqual({ key: -1 })
    expect(parseDocument('key: -x\n').toJS()).toEqual({ key: '-x' })
  })
})

describe('": " inside a plain scalar', () => {
  it('reports a second mapping indicator on the value line', () => {
    const doc = parseDocument('a: b: c: d\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_SCALAR_CONTENT'])
  })

  it('reports a continuation line that reads as a mapping entry', () => {
    expect(parseDocument('k1: v1\n k2: v2\n').errors.map((e) => e.code)).toEqual(['BAD_SCALAR_CONTENT'])
    expect(parseDocument('this\n is\n  invalid: x\n').errors.map((e) => e.code)).toEqual(['BAD_SCALAR_CONTENT'])
    expect(parseDocument('key:\n  word1 word2\n  no: key\n').errors.map((e) => e.code)).toEqual(['BAD_SCALAR_CONTENT'])
  })

  it('reports a colon that ends the scalar line', () => {
    expect(parseDocument('a: b:\n').errors.map((e) => e.code)).toEqual(['BAD_SCALAR_CONTENT'])
  })

  it('reports once per scalar, not once per line', () => {
    expect(parseDocument('a: b: c\n   d: e\n   f: g\n').errors).toHaveLength(1)
  })

  it('leaves a colon that separates nothing alone', () => {
    // No white space after the `:`, so it is ordinary scalar text.
    expect(parseDocument('a: http://example.com/x\n').errors).toHaveLength(0)
    expect(parseDocument('a: 12:30\n').toJS()).toEqual({ a: '12:30' })
    expect(parseDocument('a: b :c\n').errors).toHaveLength(0)
  })

  it('does not apply to quoted, block, or flow scalars', () => {
    expect(parseDocument("a: 'b: c'\n").toJS()).toEqual({ a: 'b: c' })
    expect(parseDocument('a: >-\n  b: c\n').toJS()).toEqual({ a: 'b: c' })
    expect(parseDocument('a: "b: c"\n').errors).toHaveLength(0)
  })
})

describe('multi-line plain scalars in flow collections', () => {
  it('folds a plain scalar that wraps across lines in a flow sequence', () => {
    expect(parseDocument('[a\nb, c]\n').toJS()).toEqual(['a b', 'c'])
    expect(parseDocument('[\n  a\n  b,\n  c\n]\n').toJS()).toEqual(['a b', 'c'])
  })

  it('folds a wrapped plain scalar down to a space regardless of its indentation', () => {
    // Every continuation line trims to its content, so the varied indentation
    // here collapses to single spaces: "a b c".
    expect(parseDocument('[a\n      b\n  c]\n').toJS()).toEqual(['a b c'])
  })

  it('collapses a run of blank lines to one fewer newline, matching quoted folding', () => {
    // Two blank lines between `a` and `b` → one literal newline.
    expect(parseDocument('[a\n\n\n  b]\n').toJS()).toEqual(['a\n\nb'])
  })

  it('folds wrapped plain scalars as both keys and values of a flow mapping', () => {
    expect(parseDocument('{key\n  two: val\n  ue}\n').toJS()).toEqual({ 'key two': 'val ue' })
    expect(parseDocument('{k: a\n  b, m: 2}\n').toJS()).toEqual({ k: 'a b', m: 2 })
  })

  it('stops the scalar at the first flow indicator on a continuation line', () => {
    // The `]` opening the third line ends the (folded) scalar; nothing after it
    // is swallowed, and the sequence closes cleanly.
    const doc = parseDocument('[a\n  b\n]\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual(['a b'])
  })

  it('spans the source range from the first line to the last folded line', () => {
    const node = parseDocument('[a\n  b, c]\n').contents
    if (node?.kind === 'seq') {
      const first = node.items[0]
      // `a` starts at offset 1; the folded scalar ends after `b` on line 2
      // (offset 6), with the trailing break and `, c]` left to the sequence.
      expect([first?.start, first?.end]).toEqual([1, 6])
    }
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

  it('rejects a deep alias chain in projection instead of overflowing the stack', () => {
    // Each link nests ~800 deep (under the parser's 1000 cap) and aliases the
    // previous one, so the *expanded* traversal is ~800×5 deep while the node
    // count stays far under the expansion budget — the shape that used to reach
    // the native stack limit and throw an uncatchable RangeError.
    const open = '['.repeat(800)
    const close = ']'.repeat(800)
    let src = `b0: &b0 ${open}0${close}\n`
    for (let i = 1; i <= 4; i++) src += `b${i}: &b${i} ${open}*b${i - 1}${close}\n`
    src += 'root: *b4\n'
    const doc = parseDocument(src)
    expect(() => doc.toJS()).toThrow(/nesting depth/i)
  })

  it('still projects a bounded alias that reuses a moderately deep subtree', () => {
    const open = '['.repeat(300)
    const close = ']'.repeat(300)
    const out = parseDocument(`base: &b ${open}1${close}\ncopy: *b\n`).toJS() as { copy: unknown[] }
    let node: unknown = out.copy
    for (let i = 0; i < 300; i++) node = (node as unknown[])[0]
    expect(node).toBe(1)
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

describe('nodes written on the `---` line', () => {
  it('keeps a block scalar opened on the marker line', () => {
    // The `|` used to be skipped with the rest of the marker line, so the body
    // below was re-read as a folded plain scalar and lost every line break.
    expect(parseDocument('--- |\n  line1\n  line2\n').toJS()).toBe('line1\nline2\n')
    expect(parseDocument('--- >\n  line1\n  line2\n').toJS()).toBe('line1 line2\n')
  })

  it('measures a marker-line block scalar against column 0, not the marker', () => {
    // `--- |` puts the indicator at column 4, but the content is the document
    // root and may legally start at column 0.
    expect(parseDocument('--- >\nline1\nline2\n').toJS()).toBe('line1 line2\n')
  })

  it('ends a marker-line block scalar at the next document marker', () => {
    const docs = parseAllDocuments('--- |\n%!PS\n...\n--- a\n')
    expect(docs.map((d) => d.toJS())).toEqual(['%!PS\n', 'a'])
  })

  it('keeps a plain, quoted, or tagged scalar written on the marker line', () => {
    expect(parseDocument('--- foo  # comment\n').toJS()).toBe('foo')
    expect(parseDocument('--- "quoted\nstring"\n').toJS()).toBe('quoted string')
    expect(parseDocument('---\tscalar\n').toJS()).toBe('scalar')
    expect(parseAllDocuments('--- !!str 1.50\n').map((d) => d.toJS())).toEqual(['1.50'])
  })

  it('applies a tag written on the marker line to the collection below it', () => {
    expect(parseDocument('--- !!set\n? a\n? b\n').toJS()).toEqual(new Set(['a', 'b']))
  })

  it('folds a multi-line plain scalar before !!str reads it', () => {
    // `!!str` normally returns the raw source so `1.50` keeps its zero, but a
    // scalar that wraps has line breaks in its source and folded text in its value.
    expect(parseDocument('--- !!str\nd\ne\n').toJS()).toBe('d e')
  })

  it('reports a block mapping started on the marker line', () => {
    expect(parseDocument('--- key1: value1\n    key2: value2\n').errors.map((e) => e.code)).toContain(
      'UNEXPECTED_CONTENT',
    )
    expect(parseDocument('--- &anchor a: b\n').errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('still accepts a flow collection on the marker line', () => {
    expect(parseDocument('--- {a: 1, b: 2}\n').toJS()).toEqual({ a: 1, b: 2 })
    expect(parseDocument('--- [1, 2]\n').errors).toHaveLength(0)
  })

  it('stops an unterminated quoted scalar at a document marker', () => {
    // Without this the open quote swallows every document after it.
    expect(parseDocument('---\n"\n---\n"\n').errors.map((e) => e.code)).toContain('UNTERMINATED_QUOTE')
    // A `...` that is not a marker (no trailing space) is ordinary content.
    expect(parseDocument('--- "a\n...x\nb"\n').toJS()).toBe('a ...x b')
  })
})

describe('flow scalars spanning lines', () => {
  it('resolves the core schema for an entry that ends its line', () => {
    // The single-line form always resolved; the wrapped form returned the raw
    // text, so the same document typed differently depending on its line breaks.
    expect(parseDocument('{ a: 1,\n  b: 2 }\n').toJS()).toEqual({ a: 1, b: 2 })
    expect(parseDocument('[ 1,\n  2.5,\n  true ]\n').toJS()).toEqual([1, 2.5, true])
  })

  it('ends a key at a `:` that opens the next line', () => {
    expect(parseDocument('{foo\n: bar}\n').toJS()).toEqual({ foo: 'bar' })
    expect(parseDocument('k: {\n k\n :\n v\n }\n').toJS()).toEqual({ k: { k: 'v' } })
  })

  it('does not fold a comment line into the scalar', () => {
    expect(parseDocument('[ word1\n# comment\n, word2]\n').toJS()).toEqual(['word1', 'word2'])
  })

  it('still folds a genuinely multi-line scalar to spaced text', () => {
    expect(parseDocument('[ one\n  two ]\n').toJS()).toEqual(['one two'])
  })
})

describe('double-quoted folding and escapes', () => {
  it('keeps escaped whitespace that sits where folding would strip it', () => {
    // The `\t` is content; only unescaped trailing whitespace is folding padding.
    expect(parseDocument('a: "x\\t\n  y"\n').toJS()).toEqual({ a: 'x\t y' })
    expect(parseDocument('a: "x\t\n  y"\n').toJS()).toEqual({ a: 'x y' })
  })

  it('swallows the break and the next line indentation on a `\\` continuation', () => {
    // The escaped break must not first fold to a space the `\` then absorbs.
    expect(parseDocument('a: "one \\\n  \\ two"\n').toJS()).toEqual({ a: 'one  two' })
  })

  it('keeps a trailing backslash on the closing line literal', () => {
    expect(parseDocument('a: "x\\\\"\n').toJS()).toEqual({ a: 'x\\' })
  })
})

describe('block scalar folding', () => {
  it('treats a tab-led line as more-indented, so the breaks around it stay literal', () => {
    expect(parseDocument('>\n  foo \n \n  \t bar\n\n  baz\n').toJS()).toBe('foo \n\n\t bar\n\nbaz\n')
  })

  it('keeps leading blank lines and interior indentation in a literal scalar', () => {
    expect(parseDocument('--- |\n \n  \n  literal\n   \n  \n  text\n\n # Comment\n').toJS()).toBe(
      '\n\nliteral\n \n\ntext\n',
    )
  })

  it('keeps trailing blank lines under `+` chomping', () => {
    expect(parseAllDocuments('--- |+\n ab\n \n  \n...\n').map((d) => d.toJS())).toEqual(['ab\n\n \n'])
  })
})

describe('stream-level directive grammar', () => {
  it('rejects a directive that no `...` footer precedes', () => {
    expect(
      parseAllDocuments('---\nkey: value\n%YAML 1.2\n---\n')
        .flatMap((d) => d.errors)
        .map((e) => e.code),
    ).toContain('UNEXPECTED_DIRECTIVE')
    // A `...` before it makes the same directive legal.
    expect(parseAllDocuments('--- |\n%!PS\n...\n%YAML 1.2\n---\n# Empty\n...\n').flatMap((d) => d.errors)).toHaveLength(
      0,
    )
  })

  it('rejects a directive no document follows', () => {
    const docs = parseAllDocuments('%YAML 1.2\n')
    expect(docs.flatMap((d) => d.errors).map((e) => e.code)).toContain('UNEXPECTED_DIRECTIVE')
  })

  it('rejects content after a `...` footer', () => {
    expect(
      parseAllDocuments('---\nkey: value\n... invalid\n')
        .flatMap((d) => d.errors)
        .map((e) => e.code),
    ).toContain('UNEXPECTED_CONTENT')
  })

  it('does not carry a %TAG handle into the next document', () => {
    const docs = parseAllDocuments('%TAG !p! tag:example.com,2011:\n--- !p!A\na: b\n--- !p!B\nc: d\n')
    expect(docs[0]?.errors ?? []).toHaveLength(0)
    expect((docs[1]?.errors ?? []).map((e) => e.code)).toContain('UNKNOWN_TAG_HANDLE')
  })

  it('rejects a tag holding a flow indicator', () => {
    expect(parseDocument('---\n!invalid{}tag scalar\n').errors.map((e) => e.code)).toContain('BAD_TAG')
    expect(parseDocument('- !!str, xxx\n').errors.map((e) => e.code)).toContain('BAD_TAG')
  })
})

describe('line breaks', () => {
  // YAML 1.2 §5.4: `b-break ::= CR LF | CR | LF`. The scanner used to look only
  // for LF when skipping to the next line, so a CR-delimited document had every
  // line after the first jumped over — and reported *no* error while doing it.
  it('treats a lone CR as a line break', () => {
    expect(parseDocument('a: 1\rb: 2\rc: 3\r').toJS()).toEqual({ a: 1, b: 2, c: 3 })
    expect(parseDocument('root:\r  x: 1\r  y: 2\r').toJS()).toEqual({ root: { x: 1, y: 2 } })
  })

  it('does not lose a key to a lone CR inside an otherwise-LF document', () => {
    const doc = parseDocument('a: 1\nb: 2\rc: 3\nd: 4\n')
    expect(doc.toJS()).toEqual({ a: 1, b: 2, c: 3, d: 4 })
    expect(doc.errors).toHaveLength(0)
  })

  it('counts CR LF as one break, not two', () => {
    expect(parseDocument('a: 1\r\nb: 2\r\n').toJS()).toEqual({ a: 1, b: 2 })
    // A phantom blank line between entries would show up as a null-valued key.
    expect(Object.keys(parseDocument('a: 1\r\nb: 2\r\n').toJS() as object)).toEqual(['a', 'b'])
  })

  it('keeps block scalars, comments, and anchors working across CR breaks', () => {
    expect(parseDocument('text: |\r  one\r  two\r').toJS()).toEqual({ text: 'one\ntwo\n' })
    expect(parseDocument('# lead\ra: 1 # tail\rb: 2\r').toJS()).toEqual({ a: 1, b: 2 })
    expect(parseDocument('a: &x\r  k: 1\rb: *x\r').toJS()).toEqual({ a: { k: 1 }, b: { k: 1 } })
  })
})

describe('merge keys over inherited property names', () => {
  // `k in target` walks the prototype chain, so every `Object.prototype` member
  // looked like a key the target already had and was dropped from the merge —
  // silently, with no diagnostic.
  it('merges keys that shadow an Object.prototype member', () => {
    const source =
      'base: &b\n' +
      '  name: n\n' +
      '  toString: TS\n' +
      '  valueOf: VO\n' +
      '  constructor: C\n' +
      '  hasOwnProperty: HOP\n' +
      '  isPrototypeOf: IPO\n' +
      'derived:\n' +
      '  <<: *b\n'
    const derived = (parseDocument(source).toJS() as Record<string, Record<string, unknown>>).derived
    expect(derived).toEqual({
      name: 'n',
      toString: 'TS',
      valueOf: 'VO',
      constructor: 'C',
      hasOwnProperty: 'HOP',
      isPrototypeOf: 'IPO',
    })
  })

  it('merges a `__proto__` key as plain data rather than polluting the prototype', () => {
    const doc = parseDocument('base: &b\n  __proto__:\n    polluted: yes\nderived:\n  <<: *b\n')
    const out = doc.toJS() as Record<string, Record<string, unknown>>
    // The key is present as data...
    expect(Object.hasOwn(out.derived as object, '__proto__')).toBe(true)
    expect((out.derived as Record<string, unknown>)['__proto__']).toEqual({ polluted: 'yes' })
    // ...and nothing leaked onto the prototype every object shares.
    expect(Object.getPrototypeOf(out.derived)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('still lets an own key written on the mapping win over the merged one', () => {
    expect(parseDocument('base: &b\n  toString: TS\nderived:\n  <<: *b\n  toString: mine\n').toJS()).toEqual({
      base: { toString: 'TS' },
      derived: { toString: 'mine' },
    })
  })
})

describe('unterminated quoted scalars', () => {
  // The error was always reported, but the recovered text lost its last
  // character — and that text is exactly what a linter echoes back at the author.
  it('keeps the final character of a scalar with no closing quote', () => {
    const doc = parseDocument('a: "abcd')
    expect(doc.toJS()).toEqual({ a: 'abcd' })
    expect(doc.errors.map((e) => e.code)).toEqual(['UNTERMINATED_QUOTE'])
  })

  it('keeps the final character through an escape', () => {
    expect(parseDocument('a: "ab\\"cd').toJS()).toEqual({ a: 'ab"cd' })
    expect(parseDocument("a: 'ab''cd").toJS()).toEqual({ a: "ab'cd" })
  })

  it('still stops at a document marker instead of swallowing every document after it', () => {
    const doc = parseDocument('a: "abcd\n---\nb: 2\n')
    expect(doc.toJS()).toEqual({ a: 'abcd' })
    expect(doc.errors.map((e) => e.code)).toContain('UNTERMINATED_QUOTE')
  })
})

describe('truncated multi-document streams', () => {
  // `parseDocument` reading only the first document is documented, but a caller
  // on `parse()` only sees the data — truncated input is indistinguishable from
  // a document that genuinely held those keys alone.
  it('warns when a second document follows the one it read', () => {
    const doc = parseDocument('a: 1\n---\nb: 2\n')
    expect(doc.toJS()).toEqual({ a: 1 })
    expect(doc.errors).toHaveLength(0)
    const warning = doc.warnings.find((w) => w.code === 'MULTIPLE_DOCUMENTS')
    expect(warning?.message).toContain('parseAllDocuments')
    // The span points at the marker that opened the document we skipped.
    expect(doc.warnings[0]).toMatchObject({ start: 5, end: 8 })
  })

  it('warns for a document that follows a `...` footer', () => {
    expect(parseDocument('a: 1\n...\n---\nb: 2\n').warnings.map((w) => w.code)).toEqual(['MULTIPLE_DOCUMENTS'])
  })

  it('stays quiet for a trailing marker with nothing under it', () => {
    expect(parseDocument('a: 1\n...\n').warnings).toHaveLength(0)
    expect(parseDocument('a: 1\n---\n').warnings).toHaveLength(0)
    expect(parseDocument('a: 1\n---\n# just a comment\n').warnings).toHaveLength(0)
  })
})

describe('block scalar indentation indicator at the document root', () => {
  /**
   * A deliberate, spec-led divergence from `yaml` (eemeli), pinned here because
   * the yaml-test-suite has no case for it. `l-bare-document` is
   * `s-l+block-node(-1, block-in)`, and `c-l+literal(n)` holds
   * `l-literal-content(n+m,t)` — so at the root `n` is -1 and an explicit `|2`
   * means content indent 1, leaving one space of the two on each line. `js-yaml`
   * reads it the same way; `yaml` treats the root as n = 0 and strips both.
   */
  it('counts an explicit indicator from -1 at the root', () => {
    expect(parseDocument('|2\n  x\n').toJS()).toBe(' x\n')
    expect(parseDocument('>2\n  x\n').toJS()).toBe(' x\n')
    expect(parseDocument('|1\n  x\n').toJS()).toBe('  x\n')
  })

  it('counts it the same way for a scalar written on the `---` line', () => {
    expect(parseDocument('--- |2\n  x\n').toJS()).toBe(' x\n')
  })

  it('counts it from the parent indent everywhere else', () => {
    // Nested and sequence forms measure from the parent's own column, and there
    // every implementation agrees.
    expect(parseDocument('k: |2\n   x\n').toJS()).toEqual({ k: ' x\n' })
    expect(parseDocument('- |2\n   x\n').toJS()).toEqual([' x\n'])
  })
})

describe('alias projection identity', () => {
  /**
   * Two aliases to one anchored collection project to two *copies*, not one
   * shared object. The spec makes them the same node, but `toJS()` is documented
   * as a plain tree — a path-keyed position index, a JSON round-trip, and any
   * consumer that edits the projection all rely on that. Pinned so the choice is
   * a decision rather than an accident.
   */
  it('gives each alias to a collection its own object', () => {
    const out = parseDocument('a: &x {p: 1}\nb: *x\nc: *x\n').toJS() as Record<string, Record<string, unknown>>
    expect(out.b).toEqual(out.c)
    expect(out.b).not.toBe(out.c)
    ;(out.b as Record<string, unknown>).p = 99
    expect((out.c as Record<string, unknown>).p).toBe(1)
  })
})

describe('block scalar headers', () => {
  it('reports text after the block scalar indicators', () => {
    expect(parseDocument('folded: > first line\n  second line\n').errors.map((e) => e.code)).toContain(
      'BAD_BLOCK_HEADER',
    )
    // `0` is not a legal indentation indicator, and the `0` of `|10` is left over.
    expect(parseDocument('a: |0\n x\n').errors.map((e) => e.code)).toContain('BAD_BLOCK_HEADER')
    expect(parseDocument('a: |10\n  x\n').errors.map((e) => e.code)).toContain('BAD_BLOCK_HEADER')
  })

  it('reports a comment with no whitespace before it', () => {
    expect(parseDocument('block: ># comment\n  scalar\n').errors.map((e) => e.code)).toContain('BAD_BLOCK_HEADER')
  })

  it('reports an indicator written twice', () => {
    expect(parseDocument('a: |--\n  x\n').errors.map((e) => e.code)).toContain('BAD_BLOCK_HEADER')
    expect(parseDocument('a: |12\n  x\n').errors.map((e) => e.code)).toContain('BAD_BLOCK_HEADER')
  })

  it('still accepts every legal header, in either indicator order', () => {
    for (const header of ['|', '>', '|-', '>+', '|2-', '|-2', '> # comment']) {
      expect(parseDocument(`a: ${header}\n  x\n`).errors).toHaveLength(0)
    }
  })

  it('reports a leading blank line indented deeper than the first content line', () => {
    const doc = parseDocument('block scalar: |\n     \n  content\n')
    expect(doc.errors.map((e) => e.code)).toContain('BAD_INDENT')
  })

  it('keeps a more-indented blank line once the content indent is known', () => {
    const doc = parseDocument('a: |\n  one\n     \n  two\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ a: 'one\n   \ntwo\n' })
  })
})

describe('quoted scalar escapes and indentation', () => {
  it('reports an escape the spec does not define, keeping the character', () => {
    const doc = parseDocument('a: "b\\.c"\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
    expect(doc.toJS()).toEqual({ a: 'b.c' })
    // `\'` is a single-quoted escape; inside double quotes it means nothing.
    expect(parseDocument('a: "quoted \\\' scalar"\n').errors.map((e) => e.code)).toContain('BAD_ESCAPE')
  })

  it('accepts every escape the spec does define', () => {
    expect(
      parseDocument('a: "\\0\\a\\b\\t\\n\\v\\f\\r\\e\\ \\"\\/\\\\\\N\\_\\L\\P\\x41\\u0041\\U00000041"\n').errors,
    ).toHaveLength(0)
  })

  it('reports a continuation line that does not clear the parent indentation', () => {
    expect(parseDocument('---\nquoted: "a\nb\nc"\n').errors.map((e) => e.code)).toContain('BAD_INDENT')
    // Reported once, however many lines are wrong.
    expect(parseDocument('---\nquoted: "a\nb\nc"\n').errors.filter((e) => e.code === 'BAD_INDENT')).toHaveLength(1)
  })

  it('accepts a properly indented continuation, and one at the document root', () => {
    expect(parseDocument('quoted: "a\n  b\n  c"\n').errors).toHaveLength(0)
    expect(parseDocument('"a\nb\nc"\n').errors).toHaveLength(0)
  })

  it('reports a quoted key that spans lines', () => {
    expect(parseDocument('"a\n b": 1\n').errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
    expect(parseDocument("'a\n b': 1\n").errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
  })
})

describe('comments that need whitespace before them', () => {
  it('reports a comment glued to the node it follows', () => {
    expect(parseDocument('key: "value"# invalid\n').errors.map((e) => e.code)).toEqual(['BAD_COMMENT'])
    expect(parseDocument('---\n[ a, b ]#invalid\n').errors.map((e) => e.code)).toEqual(['BAD_COMMENT'])
  })

  it('reports a comment glued to a comma inside a flow collection', () => {
    expect(parseDocument('---\n[ a, b,#invalid\n]\n').errors.map((e) => e.code)).toEqual(['BAD_COMMENT'])
  })

  it('still accepts a properly separated comment after every node kind', () => {
    expect(parseDocument('a: &x 1\nb: *x # fine\nc: "q" # fine\nd: [1] # fine\n').errors).toHaveLength(0)
    expect(parseDocument('a: [1, 2] # fine\n').errors).toHaveLength(0)
  })

  it('ends a plain scalar at its comment instead of folding the line below in', () => {
    // The comment closes the scalar, so `word2` is content no node claims.
    const doc = parseDocument('word1  # comment\nword2\n')
    expect(doc.toJS()).toBe('word1')
    expect(doc.errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
    const nested = parseDocument('---\nplain: a\n       b # end of scalar\n       c\n')
    expect(nested.toJS()).toEqual({ plain: 'a b' })
    expect(nested.errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('still folds a multi-line plain scalar whose lines carry no comment', () => {
    expect(parseDocument('plain: a\n  b\n  c\n').toJS()).toEqual({ plain: 'a b c' })
  })
})

describe('flow collection boundaries', () => {
  it('reports a `-` used where a flow entry belongs', () => {
    expect(parseDocument('[-]\n').errors.map((e) => e.code)).toContain('BAD_SCALAR_START')
    expect(parseDocument('---\n- [-, -]\n').errors.map((e) => e.code)).toContain('BAD_SCALAR_START')
  })

  it('keeps a plain scalar that merely starts with `-`', () => {
    expect(parseDocument('[-1, -x]\n').errors).toHaveLength(0)
    expect(parseDocument('[-1, -x]\n').toJS()).toEqual([-1, '-x'])
  })

  it('reports a document marker inside a flow collection', () => {
    expect(parseDocument('[\n--- ,\n]\n').errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('reports a single-pair sequence entry whose `:` is on the next line', () => {
    expect(parseDocument('---\n[ key\n  : value ]\n').errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
    expect(parseDocument('---\n[ "key"\n  :value ]\n').errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
  })

  it('still lets a flow mapping put its `:` on the next line', () => {
    // A flow *mapping* entry may be separated across lines; only the compact
    // single-pair form inside a sequence requires an implicit (one-line) key.
    expect(parseDocument('{"foo"\n: "bar"}\n').errors).toHaveLength(0)
    expect(parseDocument('{foo\n: bar}\n').toJS()).toEqual({ foo: 'bar' })
  })

  it('reports a flow collection used as a block key that spans lines', () => {
    expect(parseDocument('[23\n]: 42\n').errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
    // The same key on one line is a supported shape.
    expect(parseDocument('[23]: 42\n').errors).toHaveLength(0)
  })
})

describe('node property errors', () => {
  it('reports an anchor or tag written on an alias', () => {
    expect(parseDocument('key1: &a value\nkey2: &b *a\n').errors.map((e) => e.code)).toContain('BAD_PROPERTY')
    expect(parseDocument('key1: &a value\nkey2: !!str *a\n').errors.map((e) => e.code)).toContain('BAD_PROPERTY')
  })

  it('reports two anchors reaching one scalar', () => {
    expect(parseDocument('top: &node1\n  &v2 val2\n').errors.map((e) => e.code)).toContain('BAD_PROPERTY')
  })

  it('still accepts an anchor above the collection it describes', () => {
    // `&node1` names the mapping and `&k1` names its first key — two anchors, on
    // two different nodes, so neither is a redefinition of the other.
    const doc = parseDocument('top1: &node1\n  &k1 key1: one\ntop2: &node2\n  key2: two\n')
    expect(doc.errors).toHaveLength(0)
  })

  it('reports a block sequence opened on the line its properties are on', () => {
    expect(parseDocument('&anchor - sequence entry\n').errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
    // The sequence below the properties line is the legal shape.
    expect(parseDocument('&anchor\n- sequence entry\n').errors).toHaveLength(0)
  })
})

describe('indentation measured against the parent, not the node', () => {
  it('folds a continuation line that steps back but still clears the mapping', () => {
    // `bar` is indented past `a:` (column 0), which is all a continuation needs
    // — it does not have to reach the column `foo` happens to start at.
    const doc = parseDocument('a:\n  foo\n bar\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ a: 'foo bar' })
  })

  it('folds a sequence entry whose continuation looks like a second entry', () => {
    expect(parseDocument('- single multiline\n - sequence entry\n').toJS()).toEqual([
      'single multiline - sequence entry',
    ])
  })

  it('still ends the scalar at a line that reaches the parent column', () => {
    expect(parseDocument('a:\n  foo\nbar\n').errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('attaches a tag to the zero-indented sequence it introduces', () => {
    expect(parseDocument('sequence: !!seq\n- entry\n- !!seq\n - nested\n').toJS()).toEqual({
      sequence: ['entry', ['nested']],
    })
  })

  it('attaches an anchor on its own line to the zero-indented sequence below', () => {
    const doc = parseDocument('seq:\n &anchor\n- a\n- b\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ seq: ['a', 'b'] })
  })

  it('counts a block scalar indentation indicator from the mapping, not the tag line', () => {
    expect(parseDocument('literal: |2\n  value\nfolded:\n   !foo\n  >1\n value\n').toJS()).toEqual({
      literal: 'value\n',
      folded: 'value\n',
    })
  })
})

describe('node properties on block mapping keys', () => {
  it('anchors the key, not the mapping the key opens', () => {
    // `&a` names the scalar `a` — so `*a` is the string, not the whole map.
    const doc = parseDocument('&a a: b\nx: *a\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ a: 'b', x: 'a' })
  })

  it('resolves an alias to a key anchored further up the mapping', () => {
    expect(parseDocument('&a a: &b b\n*b : *a\n').toJS()).toEqual({ a: 'b', b: 'a' })
  })

  it('applies a tag written on a key', () => {
    expect(parseDocument('!!str 23: 1\n').toJS()).toEqual({ '23': 1 })
    expect(parseDocument('!!str &a1 "foo":\n  bar\nbaz: *a1\n').toJS()).toEqual({ foo: 'bar', baz: 'foo' })
  })

  it('reads an anchor name that ends in a colon', () => {
    // `&a:` names `a:`, so the separator is the *next* colon on the line — the
    // one after `key`. Scanning for the separator first would split `&a` off.
    expect(parseDocument('&a: key: &a value\nfoo:\n  *a:\n').toJS()).toEqual({ key: 'value', foo: 'key' })
  })

  it('reports properties written on an alias used as a key', () => {
    const doc = parseDocument('key1: &alias value1\n&b *alias : value2\n')
    expect(doc.errors.map((e) => e.code)).toContain('BAD_PROPERTY')
  })

  it('keeps properties on a line of their own describing the collection below', () => {
    const doc = parseDocument('&whole\na: 1\nb: 2\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.contents?.anchor).toBe('whole')
  })

  it('does not swallow the line that ends the mapping', () => {
    // `&stray` opens no entry, so it is content the document never attached.
    const doc = parseDocument('a: 1\n&stray\n')
    expect(doc.errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })
})

describe('tabs, indentation, and separation', () => {
  it('accepts a tab that sits past the indentation a line owes its context', () => {
    // The value of `foo:` owes one column of indentation; the space supplies it and
    // the tab is separation. Reporting any leading tab at all rejected this.
    const doc = parseDocument('foo:\n \tbar\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ foo: 'bar' })
  })

  it('accepts a tab before a root node, which owes no indentation at all', () => {
    for (const source of ['\t[\n\t]\n', '\t{}\n']) {
      const doc = parseDocument(source)
      expect(doc.errors).toHaveLength(0)
    }
    expect(parseDocument('\t[\n\t]\n').toJS()).toEqual([])
    expect(parseDocument('\t{}\n').toJS()).toEqual({})
  })

  it('still reports a tab that stands in for indentation the line does owe', () => {
    const doc = parseDocument('---\na:\n\tb:\n\t\tc: value\n')
    expect(doc.errors.map((e) => e.code)).toContain('TAB_INDENT')
  })

  it('reports a tab between an indicator and the compact collection it opens', () => {
    // The collection's entries align under the column it lands on, and indentation
    // is spaces — so the tab cannot form it.
    for (const source of ['-\t-\n', '- \t-\n', '?\t-\n', '? -\n:\t-\n', '?\tkey:\n', '? key:\n:\tkey:\n']) {
      expect(parseDocument(source).errors.map((e) => e.code)).toContain('TAB_INDENT')
    }
  })

  it('leaves a tab before a scalar or a nested entry alone', () => {
    // Separation, not indentation: no collection opens at the tab's column.
    for (const source of ['-\t-1\n', '- foo:\t bar\n', '? a\n: -\tb\n  -  -\tc\n     - d\n']) {
      expect(parseDocument(source).errors).toHaveLength(0)
    }
    expect(parseDocument('-\t-1\n').toJS()).toEqual([-1])
  })

  it('reports a tab where a block scalar wanted indentation, and keeps one that is content', () => {
    // `\t` at column 0 cannot indent the scalar; ` \t` clears the parent and is content.
    expect(parseDocument('foo: |\n\t\nbar: 1\n').errors.map((e) => e.code)).toContain('TAB_INDENT')
    const valid = parseDocument('foo: |\n \t\nbar: 1\n')
    expect(valid.errors).toHaveLength(0)
    expect(valid.toJS()).toEqual({ foo: '\t\n', bar: 1 })
  })
})

describe('flow collection indentation', () => {
  it('reports a flow sequence whose continuation lines sit at the parent column', () => {
    const doc = parseDocument('---\nflow: [a,\nb,\nc]\n')
    expect(doc.errors.map((e) => e.code)).toContain('BAD_INDENT')
  })

  it('reports a flow mapping whose continuation lines sit at the parent column', () => {
    expect(parseDocument('k: {\nk\n:\nv\n}\n').errors.map((e) => e.code)).toContain('BAD_INDENT')
  })

  it('reports it once per collection rather than once per line', () => {
    const doc = parseDocument('---\nflow: [a,\nb,\nc]\n')
    expect(doc.errors.filter((e) => e.code === 'BAD_INDENT')).toHaveLength(1)
  })

  it('accepts a properly indented multi-line flow collection', () => {
    const doc = parseDocument('flow: [\n  a,\n  b,\n  ]\nnext: 1\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ flow: ['a', 'b'], next: 1 })
  })

  it('lets the closing delimiter sit at the parent column, as every formatter writes it', () => {
    for (const source of ['flow: [\n  a,\n  b,\n]\nnext: 1\n', 'flow: {\n  a: 1,\n}\nnext: 2\n', '- [\n  a,\n]\n']) {
      expect(parseDocument(source).errors).toHaveLength(0)
    }
    expect(parseDocument('flow: [\n  a,\n  b,\n]\nnext: 1\n').toJS()).toEqual({ flow: ['a', 'b'], next: 1 })
  })

  it('still reports a closing delimiter further out than its parent', () => {
    expect(parseDocument('a:\n  b:\n    c: [\n      1,\n]\n').errors.map((e) => e.code)).toContain('BAD_INDENT')
  })

  it('measures indentation in spaces, so a tab cannot make up the shortfall', () => {
    expect(parseDocument('- [\n\tfoo,\n foo\n ]\n').errors.map((e) => e.code)).toContain('BAD_INDENT')
    // The same line with nothing but a tab on it is blank, and blank lines are exempt.
    const blank = parseDocument('- [\n\t\n foo\n ]\n')
    expect(blank.errors).toHaveLength(0)
    expect(blank.toJS()).toEqual([['foo']])
  })

  it('holds a root-level flow collection to nothing, since the root owes no indentation', () => {
    const doc = parseDocument('[\na,\nb,\n]\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual(['a', 'b'])
  })
})

describe('flow node properties', () => {
  it('ends a tag shorthand at the flow indicator that follows it', () => {
    // `!!str,` is not a tag name: inside a flow collection the `,` ends the token.
    const doc = parseDocument('{\n  foo : !!str,\n  !!str : bar,\n}\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ foo: '', '': 'bar' })
  })

  it('ends an anchor at the flow indicator that follows it', () => {
    const doc = parseDocument('[ &a x, *a ]\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual(['x', 'x'])
  })

  it('keeps a flow indicator inside a block-context tag reportable', () => {
    // Outside a flow collection those characters are tag content, and an illegal one.
    expect(parseDocument('a: !!str, b\n').errors.map((e) => e.code)).toContain('BAD_TAG')
  })
})

describe('implicit key length', () => {
  const long = 'k'.repeat(1100)

  it('reports a block mapping key whose ":" is more than 1024 characters in', () => {
    expect(parseDocument(`${long}: 1\n`).errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
    expect(parseDocument(`"${long}": 1\n`).errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
  })

  it('accepts a key just inside the limit', () => {
    expect(parseDocument(`${'k'.repeat(1000)}: 1\n`).errors).toHaveLength(0)
  })

  it('does not apply the cap in a flow mapping, where JSON lives', () => {
    // `{"…1100 characters…":1}` is valid JSON, and this parser is a JSON superset.
    for (const source of [`{"${long}":1}\n`, `{${long}: 1}\n`]) {
      expect(parseDocument(source).errors).toHaveLength(0)
    }
  })

  it('lets an explicit key in a flow sequence put its ":" on the next line', () => {
    // The one-line rule exists to make an *implicit* key cheap to recognize; a `?`
    // introducer settles it up front, so `[ ? a\n : b ]` is legal where `[ a\n : b ]`
    // is not.
    expect(parseDocument('[ ? a\n : b ]\n').errors).toHaveLength(0)
    expect(parseDocument('[ a\n : b ]\n').errors.map((e) => e.code)).toContain('BAD_IMPLICIT_KEY')
  })
})

describe('tab-indented flow scalars', () => {
  it('ends a wrapped flow scalar at a closing bracket on a tab-indented line', () => {
    // A wrapped line's leading whitespace is `s-indent s-separate-in-line?`, so tabs
    // sit in it too. Skipping only spaces left the `]` unseen and folded the line
    // into the scalar, so `-1` projected as the string `"-1\n"`.
    expect(parseDocument('[\n\t[\n\t\t1,\n\t\t-1\n\t]\n]\n').toJS()).toEqual([[1, -1]])
  })

  it('parses tab-indented JSON exactly as JSON.parse does', () => {
    const source = JSON.stringify({ a: [1, -1, true], b: { c: null } }, null, '\t')
    const doc = parseDocument(source)
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual(JSON.parse(source))
  })
})

describe('sequence entries carrying only node properties', () => {
  it('keeps the entries that follow a tag-only entry', () => {
    // `- !!str` with nothing after it is an entry holding an empty (tagged)
    // scalar. The `- a` below is its *sibling*, not its content: nested content
    // would have to be indented past the dash. Adopting it as a nested sequence
    // swallowed every remaining entry, so the list came back one item long.
    const doc = parseDocument('- !!str\n- a\n- b\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual(['', 'a', 'b'])
  })

  it('keeps the entries that follow an anchor-only entry', () => {
    const doc = parseDocument('- &x\n- a\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual([null, 'a'])
  })

  it('handles a run of property-only entries', () => {
    expect(parseDocument('- &x\n- !!str\n- a\n').toJS()).toEqual([null, '', 'a'])
  })

  it('still nests content that really is indented past the dash', () => {
    // The rule this fixes is about *sibling* dashes only — an indented block
    // below a property-only entry is still that entry's content.
    expect(parseDocument('- !!seq\n  - inner\n- a\n').toJS()).toEqual([['inner'], 'a'])
    expect(parseDocument('- &x\n  k: 1\n- a\n').toJS()).toEqual([{ k: 1 }, 'a'])
  })

  it('leaves the mapping spelling alone, where the column really is shared', () => {
    // A block sequence *may* sit at its mapping's own column, so `seq: &anchor`
    // over a zero-indented list still adopts it. Only the sequence-entry case
    // changed.
    expect(parseDocument('seq: &anchor\n- a\n- b\n').toJS()).toEqual({ seq: ['a', 'b'] })
  })
})

describe('flow collections used as block mapping keys', () => {
  it('parses a flow mapping written as an explicit key', () => {
    // The `: ` inside `{x: 1}` belongs to the flow mapping, not to the block
    // entry — reading it as the entry's separator keyed the mapping by the
    // plain scalar `{x` and left `1}` as the value.
    const doc = parseDocument('? {x: 1}\n: a\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ '{ x: 1 }': 'a' })
  })

  it('parses a flow sequence holding a mapping as an explicit key', () => {
    expect(parseDocument('? [a: 1]\n: v\n').toJS()).toEqual({ '[ { a: 1 } ]': 'v' })
  })

  it('parses a flow collection written as an explicit value', () => {
    // The value side of an explicit entry goes through the same lookahead, so
    // it corrupted the same way — silently, with no diagnostic to show for it.
    const doc = parseDocument('? k\n: {x: 1}\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ k: { x: 1 } })
  })

  it('parses a flow key on an entry that is not the mapping’s first', () => {
    // A flow key on the *first* entry has always been parsed properly (it goes
    // through `parseNodeInner`); later entries took the plain-scalar path.
    const doc = parseDocument('a: 1\n{x: 2}: v\n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.toJS()).toEqual({ a: 1, '{ x: 2 }': 'v' })
  })

  it('keys by the parsed collection, not by its source text', () => {
    // `[x, y]` sliced as text renders `[x, y]`; parsed as a sequence it renders
    // `[ x, y ]`, which is what the identical key on a first entry produces.
    expect(parseDocument('a: 1\n[x, y]: v\n').toJS()).toEqual({ a: 1, '[ x, y ]': 'v' })
    expect(parseDocument('[x, y]: v\na: 1\n').toJS()).toEqual({ a: 1, '[ x, y ]': 'v' })
  })

  it('reports a block mapping opened on the "---" line by a flow key', () => {
    const doc = parseDocument('--- {a: 1}: v\n')
    expect(doc.errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
  })

  it('still accepts a bare flow collection on the "---" line', () => {
    expect(parseDocument('--- {a: 1}\n').errors).toHaveLength(0)
    expect(parseDocument('--- [a, b]\n').errors).toHaveLength(0)
  })
})

describe('duplicate collection keys', () => {
  it('reports two collection keys that render alike', () => {
    // Both keys project to `[ a, b ]`, so the pairs collapse into one in the
    // JavaScript output. Skipping collection keys meant that happened silently.
    const doc = parseDocument('{ [a, b]: 1, [a, b]: 2 }\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['DUPLICATE_KEY'])
  })

  it('reports a collection key duplicated by an alias to it', () => {
    const doc = parseDocument('{ &a [a, b]: 1, *a : 2 }\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['DUPLICATE_KEY'])
  })

  it('leaves collection keys that render differently alone', () => {
    expect(parseDocument('{ [a, b]: 1, [a, c]: 2 }\n').errors).toHaveLength(0)
    expect(parseDocument('? [a, b]\n: 1\n? {a: 1}\n: 2\n').errors).toHaveLength(0)
  })

  it('accepts them when uniqueKeys is off', () => {
    expect(parseDocument('{ [a, b]: 1, [a, b]: 2 }\n', { uniqueKeys: false }).errors).toHaveLength(0)
  })
})

describe('comment retention', () => {
  it('collects nothing unless asked', () => {
    // The common case is parsing to data, which has no use for comments and
    // should not pay to build the list.
    expect(parseDocument('# lead\na: 1 # trailing\n').comments).toEqual([])
  })

  it('records full-line and trailing comments with exact spans', () => {
    const src = '# leading\na: 1 # inline\n'
    const doc = parseDocument(src, { keepComments: true })
    expect(doc.comments).toEqual([
      { text: ' leading', start: 0, end: 9 },
      { text: ' inline', start: 15, end: 23 },
    ])
    // The span is the comment itself, so slicing the source by it round-trips.
    for (const c of doc.comments) expect(src.slice(c.start, c.end)).toBe(`#${c.text}`)
  })

  it('does not mistake a "#" inside a scalar for a comment', () => {
    // This is the whole reason the parser reports comments rather than leaving
    // callers to scan for `#`: only the parser knows which ones are content.
    const keep = { keepComments: true }
    expect(parseDocument('a: "not # a comment"\n', keep).comments).toEqual([])
    expect(parseDocument("a: 'not # one'\n", keep).comments).toEqual([])
    expect(parseDocument('a: foo#bar\n', keep).comments).toEqual([])
    expect(parseDocument('a: |\n  body # not a comment\n', keep).comments).toEqual([])
  })

  it('does not collect a "#" glued to the token before it', () => {
    // Already reported as BAD_COMMENT — the rest of the line is not a comment,
    // so it must not be collected as one either.
    const doc = parseDocument('a: "x"# nope\n', { keepComments: true })
    expect(doc.errors.map((e) => e.code)).toContain('BAD_COMMENT')
    expect(doc.comments).toEqual([])
  })

  it('records comments inside flow collections and on marker lines', () => {
    const text = (src: string) => parseDocument(src, { keepComments: true }).comments.map((c) => c.text)
    expect(text('a: [1, # one\n  2]\n')).toEqual([' one'])
    expect(text('--- # on marker\na: 1\n')).toEqual([' on marker'])
    expect(text('%YAML 1.2\n--- # after directive\na: 1\n')).toEqual([' after directive'])
  })

  it('records a comment with no trailing newline', () => {
    expect(parseDocument('a: 1 # end', { keepComments: true }).comments).toEqual([{ text: ' end', start: 5, end: 10 }])
  })

  it('gives each document in a stream its own comments', () => {
    const docs = parseAllDocuments('# one\na: 1\n---\n# two\nb: 2\n# tail\n', { keepComments: true })
    expect(docs.map((d) => d.comments.map((c) => c.text))).toEqual([[' one'], [' two', ' tail']])
  })

  it('records each comment once, whatever the line breaks', () => {
    for (const brk of ['\n', '\r\n', '\r']) {
      const src = `# lead${brk}a: 1 # in${brk}`
      expect(parseDocument(src, { keepComments: true }).comments.map((c) => c.text)).toEqual([' lead', ' in'])
    }
  })
})

describe('aliases that point into the node containing them', () => {
  it('reports a recursive alias as such, not as a missing anchor', () => {
    // `&a` is registered once its node is complete, so the inner `*a` misses —
    // but saying it "has no matching anchor" would be false. The anchor exists;
    // the structure it describes is a cycle this parser does not build.
    for (const src of ['&a [1, *a]\n', '&a {k: *a}\n', 'a: &x\n  k: *x\n']) {
      expect(parseDocument(src).errors.map((e) => e.code)).toEqual(['RECURSIVE_ALIAS'])
    }
  })

  it('still reports a genuinely missing anchor as unresolved', () => {
    expect(parseDocument('x: *missing\n').errors.map((e) => e.code)).toEqual(['UNRESOLVED_ALIAS'])
  })

  it('leaves an ordinary backward alias alone', () => {
    const doc = parseDocument('a: &x 1\nb: *x\n')
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toEqual({ a: 1, b: 1 })
  })
})

describe('duplicate node properties on one line', () => {
  it('reports a second anchor written on the same line', () => {
    // The property scanner reads whatever is written, so the second `&` used to
    // overwrite the first and `&x` vanished with nothing reported. `yaml` and
    // `js-yaml` both reject this outright.
    const doc = parseDocument('a: &x &y 1\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_PROPERTY'])
  })

  it('reports a second tag written on the same line', () => {
    expect(parseDocument('a: !!str !!int 1\n').errors.map((e) => e.code)).toEqual(['BAD_PROPERTY'])
  })

  it('still accepts one anchor and one tag together, in either order', () => {
    expect(parseDocument('a: &x !!str 1\n').errors).toEqual([])
    expect(parseDocument('a: !!str &x 1\n').errors).toEqual([])
    expect(parseDocument('a: &x !!str 1\n').toJS()).toEqual({ a: '1' })
  })

  it('reports the multi-line spelling exactly once, as before', () => {
    // `&x` on its own line above a `&y` value is caught in `attachProps`; the
    // one-line rule must not make that report twice.
    expect(parseDocument('a:\n  &x\n  &y 1\n').errors.map((e) => e.code)).toEqual(['BAD_PROPERTY'])
  })
})

describe('numeric tags written on a quoted scalar', () => {
  it('reads every core-schema number spelling, whether or not it was quoted', () => {
    // `parseInt` alone stops at the `x` of `0x1F` and reads `0`, so quoting a
    // value used to change what its tag meant.
    expect(parseDocument('a: !!int "0x1F"\n').toJS()).toEqual({ a: 31 })
    expect(parseDocument('a: !!int 0x1F\n').toJS()).toEqual({ a: 31 })
    expect(parseDocument('a: !!int "0o17"\n').toJS()).toEqual({ a: 15 })
    expect(parseDocument('a: !!float ".inf"\n').toJS()).toEqual({ a: Number.POSITIVE_INFINITY })
    expect(parseDocument('a: !!float "-.inf"\n').toJS()).toEqual({ a: Number.NEGATIVE_INFINITY })
    expect(parseDocument('a: !!float "1e3"\n').toJS()).toEqual({ a: 1000 })
  })

  it('still truncates a float to an int and leaves unparseable text alone', () => {
    expect(parseDocument('a: !!int "1.5"\n').toJS()).toEqual({ a: 1 })
    expect(parseDocument('a: !!int "42 items"\n').toJS()).toEqual({ a: 42 })
    expect(parseDocument('a: !!int "abc"\n').toJS()).toEqual({ a: 'abc' })
    expect(parseDocument('a: !!float "abc"\n').toJS()).toEqual({ a: 'abc' })
  })
})

describe('problem ordering', () => {
  it('reports problems in source order', () => {
    // A duplicate key is only detected once its value has been parsed, so it is
    // raised after any problem found inside that value even though the key comes
    // first — a consumer showing "the first error" would otherwise name the wrong one.
    const source = 'a: 1\nb: [1,,2]\na: 2\nc: "unterminated\n'
    const { errors } = parseDocument(source)
    expect(errors.map((e) => e.start)).toEqual([...errors.map((e) => e.start)].sort((x, y) => x - y))
    expect(errors.map((e) => e.code)).toEqual(['UNEXPECTED_COMMA', 'DUPLICATE_KEY', 'UNTERMINATED_QUOTE'])
  })
})

describe('scanning cost on colon-free documents', () => {
  it('parses a large list of plain scalars in linear time', { timeout: 5_000 }, () => {
    // Finding the `: ` a plain scalar may not contain used to be handed to
    // `indexOf`, which cannot be told where to stop and so searched to the end of
    // the *document* — making a large colon-free tail (a long list of hostnames,
    // package names, an allow-list) cost O(n^2). This document has no colon at
    // all, so every entry paid the full remaining length: it took over a minute,
    // against well under a second linear. The size is what makes the guard
    // meaningful — a quadratic scan cannot finish inside the timeout.
    const entries = 300_000
    const source = `${Array.from({ length: entries }, () => '- alpha beta gamma').join('\n')}\n`
    const value = parseDocument(source).toJS()
    expect(Array.isArray(value) && value.length).toBe(entries)
  })
})

describe('resource exhaustion through a mapping key', () => {
  it('parses a key built from exponentially expanding aliases without hanging', { timeout: 10_000 }, () => {
    // The "billion laughs" shape, reaching the *parser* rather than `toJS`: each
    // level names the one below it ten times, so rendering the final key expands
    // to 10^11 nodes from 600 bytes of source. Duplicate-key tracking renders
    // every key it sees, so `parseDocument` itself hung — on a document small
    // enough to arrive in a request body.
    const lines = ['a0: &a0 [x, x, x, x, x, x, x, x, x, x]']
    for (let level = 1; level < 12; level++) {
      lines.push(
        `a${level}: &a${level} [${Array(10)
          .fill(`*a${level - 1}`)
          .join(', ')}]`,
      )
    }
    lines.push('[*a11, *a11]: boom')
    const doc = parseDocument(`${lines.join('\n')}\n`)
    expect(doc.errors).toEqual([])
    // Parsing renders every key, to track duplicates — so the key it produced for
    // the last entry has to be a bounded string rather than an expansion.
    const last = doc.contents?.kind === 'map' ? doc.contents.items.at(-1)?.key : undefined
    const rendered = keyText(last as YamlNode)
    expect(rendered.startsWith('[ ')).toBe(true)
    expect(rendered.length).toBeLessThan(8_192)
    // Projecting it is the documented resource-exhaustion throw, not a hang.
    expect(() => doc.toJS()).toThrow(/resource-exhaustion/)
  })

  it('cuts short a key holding a very long list', () => {
    const items = Array.from({ length: 50_000 }, (_, i) => i).join(', ')
    const doc = parseDocument(`[${items}]: v\n`)
    const [key] = Object.keys(doc.toJS() as object)
    expect(key?.length).toBeLessThan(8_192)
    expect(key?.endsWith('… ]')).toBe(true)
  })

  it('renders a deeply chained alias key without overflowing the stack', () => {
    // An alias chain is not bounded by the parser's nesting cap — every link sits
    // at the same depth — so the key renderer needs a bound of its own, and it
    // has to stop well before the stack does.
    const leaf = { kind: 'scalar', value: 'leaf', source: 'leaf', style: 'plain', start: 0, end: 4 } as YamlNode
    let chain: YamlNode = leaf
    for (let i = 0; i < 50_000; i++) chain = { kind: 'alias', source: 'x', start: 0, end: 0, target: chain }
    expect(keyText(chain)).toBe('…')
    // A chain short enough to afford still resolves through to the value it names.
    let short: YamlNode = leaf
    for (let i = 0; i < 100; i++) short = { kind: 'alias', source: 'x', start: 0, end: 0, target: short }
    expect(keyText(short)).toBe('leaf')
  })

  it('does not loop forever on a hand-built cyclic alias', () => {
    // `keyText` is exported and `nodeAtPath` hands it whatever tree a caller
    // built, so a cycle no parser would produce still has to terminate.
    const cyclic = { kind: 'alias', source: 'x', start: 0, end: 0 } as YamlAlias
    cyclic.target = cyclic
    expect(keyText(cyclic)).toBe('…')
  })
})

describe('scalar folding cost', () => {
  it('folds a scalar holding a long run of interior whitespace in linear time', { timeout: 5_000 }, () => {
    // Trailing-whitespace trimming used to be `replace(/[ \t]+$/, '')`. The
    // unanchored `+$` restarts at every index and walks the whole run before
    // failing the anchor, so folding was quadratic in the length of the run: an
    // 80 KB scalar took ten seconds, from input a caller hands straight in.
    const run = ' '.repeat(120_000)
    for (const source of [`a: x${run}y\n  tail\n`, `a: 'x${run}y\n  tail'\n`, `[ x${run}y\n  tail ]\n`]) {
      expect(parseDocument(source).errors).toEqual([])
    }
  })
})

describe('spans of an unterminated quoted scalar', () => {
  it('keeps a scalar ending in a backslash inside the source', () => {
    // The escape scan stepped over two characters even when only one was left,
    // putting the scalar's `end` — and every enclosing node's — one past the end
    // of the input.
    const source = 'a: "b\\'
    const doc = parseDocument(source)
    const value = doc.contents?.kind === 'map' ? doc.contents.items[0]?.value : undefined
    expect(value?.end).toBe(source.length)
    expect(doc.contents?.end).toBe(source.length)
    expect(doc.errors.map((e) => [e.code, e.end])).toEqual([['UNTERMINATED_QUOTE', source.length]])
  })
})

describe('stream-level diagnostics at scale', () => {
  it('collects more tail problems than an argument list can hold', { timeout: 10_000 }, () => {
    // The trailing problems were moved onto the last document with
    // `push(...list)`, which passes one argument per element — V8 throws a
    // `RangeError` somewhere past 125,000 of them. A megabyte of directives after
    // the final document reaches that, and this parser does not throw.
    const source = `a: 1\n...\n${'%FOO\n'.repeat(200_000)}`
    const docs = parseAllDocuments(source)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.warnings.length).toBe(200_000)
  })
})

describe('the "..." document-end marker', () => {
  it('does not treat three dots glued to content as a marker', () => {
    // A marker has to stand alone. Matching the three dots on their own swallowed
    // `...abc` and `....` as document ends, so `parseDocument` returned an empty
    // document with no diagnostic at all — while `parseAllDocuments` on the very
    // same source parsed them correctly.
    expect(parseDocument('...abc\n').toJS()).toBe('...abc')
    expect(parseDocument('....\n').toJS()).toBe('....')
    expect(parseDocument('...abc: 1\n').toJS()).toEqual({ '...abc': 1 })
    expect(parseDocument('...abc\n').errors).toEqual([])
  })

  it('still reads a marker that does stand alone as one', () => {
    expect(parseDocument('...\n').toJS()).toBeNull()
    expect(parseDocument('... # trailing\n').toJS()).toBeNull()
  })

  it('agrees with parseAllDocuments', () => {
    for (const source of ['...abc\n', '....\n', '...abc: 1\n', '...\n', 'a: 1\n...\n']) {
      const [first] = parseAllDocuments(source)
      expect(parseDocument(source).toJS()).toEqual(first ? first.toJS() : null)
    }
  })
})

describe('anchor and alias names ending in ":"', () => {
  it('warns that the ":" belongs to the name', () => {
    // YAML makes `:` a legal anchor character, so `*x: v` names the anchor `x:`
    // and the mapping loses its separator. The parser follows the spec, but the
    // `UNRESOLVED_ALIAS` it earns names an anchor the author never wrote.
    const { warnings, errors } = parseDocument('k: &x n\n*x: v\n')
    expect(warnings.map((w) => w.code)).toEqual(['AMBIGUOUS_ANCHOR_NAME'])
    expect(errors.map((e) => e.code)).toEqual(['UNRESOLVED_ALIAS'])
  })

  it('warns on the anchor spelling too, in block and flow context', () => {
    expect(parseDocument('&a: key: value\n').warnings.map((w) => w.code)).toEqual(['AMBIGUOUS_ANCHOR_NAME'])
    expect(parseDocument('{&a: 1}\n').warnings.map((w) => w.code)).toEqual(['AMBIGUOUS_ANCHOR_NAME'])
  })

  it('says nothing about an ordinary anchor or alias', () => {
    const doc = parseDocument('a: &x 1\nb: *x\nc: [*x, &y 2]\n')
    expect(doc.warnings).toEqual([])
    expect(doc.errors).toEqual([])
  })
})
