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
    // `&node` names the mapping; `&k1` stays part of the key text (a documented
    // gap), so the two must not read as two anchors on one node.
    const doc = parseDocument('top1: &node1\n  &k1 key1: one\ntop2: &node2\n  key2: two\n')
    expect(doc.errors).toHaveLength(0)
  })

  it('reports a block sequence opened on the line its properties are on', () => {
    expect(parseDocument('&anchor - sequence entry\n').errors.map((e) => e.code)).toContain('UNEXPECTED_CONTENT')
    // The sequence below the properties line is the legal shape.
    expect(parseDocument('&anchor\n- sequence entry\n').errors).toHaveLength(0)
  })
})
