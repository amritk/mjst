import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { nodeAtPath } from './node-at-path'
import { parseDocument } from './parse-document'

/** Error codes, in order — the shape most of these assertions care about. */
const errorCodes = (source: string): string[] => parseDocument(source).errors.map((e) => e.code)

/** Warning codes, in order. */
const warningCodes = (source: string): string[] => parseDocument(source).warnings.map((e) => e.code)

/** The `a` value of a one-key document. */
const valueOfA = (source: string): unknown => (parseDocument(source).toJS() as { a: unknown }).a

describe('scalars-and-tags', () => {
  it('reports a \\x, \\u or \\U escape without its full run of hex digits and keeps it as written', () => {
    // `\u12"` used to lose its backslash and read as the text `u12`, silently.
    const doc = parseDocument('a: "\\u12"\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
    expect(doc.errors[0]).toMatchObject({ start: 4, end: 8 })
    expect(doc.toJS()).toEqual({ a: '\\u12' })

    expect(errorCodes('a: "\\x4"\n')).toEqual(['BAD_ESCAPE'])
    expect(valueOfA('a: "\\x4"\n')).toBe('\\x4')
    expect(errorCodes('a: "\\xZZ"\n')).toEqual(['BAD_ESCAPE'])
    expect(valueOfA('a: "\\xZZ"\n')).toBe('\\xZZ')
    // A Windows path is the realistic way to write this by accident.
    expect(errorCodes('a: "C:\\Users"\n')).toEqual(['BAD_ESCAPE'])
    expect(valueOfA('a: "C:\\Users"\n')).toBe('C:\\Users')
  })

  it('reports a \\U escape past the last Unicode code point', () => {
    for (const written of ['\\UFFFFFFFF', '\\U00110000']) {
      const doc = parseDocument(`a: "${written}"\n`)
      expect(doc.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
      expect(doc.errors[0]).toMatchObject({ start: 4, end: 14 })
      expect(doc.toJS()).toEqual({ a: written })
    }
    expect(errorCodes('a: "\\U0010FFFF"\n')).toEqual([])
    expect(valueOfA('a: "\\U0010FFFF"\n')).toBe(String.fromCodePoint(0x10ffff))
  })

  it('reports a backslash in front of a non-ASCII character, spanning the whole character', () => {
    const accent = parseDocument('a: "\\é"\n')
    expect(accent.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
    expect(accent.errors[0]).toMatchObject({ start: 4, end: 6 })
    expect(accent.toJS()).toEqual({ a: '\\é' })

    // An astral character is two UTF-16 units; the span and message cover both.
    const emoji = parseDocument('a: "\\😀"\n')
    expect(emoji.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
    expect(emoji.errors[0]).toMatchObject({ start: 4, end: 7 })
    expect(emoji.errors[0]?.message).toContain('😀')
    expect(emoji.toJS()).toEqual({ a: '\\😀' })
  })

  it('keeps an undefined single-character escape as written', () => {
    const doc = parseDocument('a: "b\\.c"\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_ESCAPE'])
    expect(doc.toJS()).toEqual({ a: 'b\\.c' })
  })

  it('still combines escaped surrogate halves into one character', () => {
    expect(errorCodes('a: "\\ud83d\\ude00"\n')).toEqual([])
    expect(valueOfA('a: "\\ud83d\\ude00"\n')).toBe('😀')
    expect(valueOfA('a: "\\x41\\u0041\\U00000041"\n')).toBe('AAA')
  })

  it('keys a mapping by the tagged value of a scalar key', () => {
    expect(parseDocument('!!str 1.50: x\n').toJS()).toEqual({ '1.50': 'x' })

    // `1.0` and `1` are the same number, but `!!str 1.0` is not that number.
    const doc = parseDocument('!!str 1.0: a\n1: b\n')
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toEqual({ '1.0': 'a', '1': 'b' })

    // A key and an alias to it have to agree on what the key is.
    expect(parseDocument('&k !!str 1.50: x\ny: *k\n').toJS()).toEqual({ '1.50': 'x', y: '1.50' })

    expect(parseDocument('{!!str 1.50: x}\n').toJS()).toEqual({ '1.50': 'x' })
  })

  it('reports duplicate keys that only collide once their tags apply', () => {
    expect(errorCodes('!!int "1": a\n1: b\n')).toEqual(['DUPLICATE_KEY'])
    // Through an alias, which renders its key by the same rule.
    expect(errorCodes('&k !!str 1.50: x\n*k : y\n')).toEqual(['DUPLICATE_KEY'])
    expect(errorCodes('&k !!str 1.50: x\n1.50: y\n')).toEqual([])
  })

  it('renders a tagged scalar inside a collection key by its tagged value', () => {
    expect(parseDocument('[!!str 1.50, !!null ""]: x\n').toJS()).toEqual({ '[ 1.50, null ]': 'x' })
  })

  it('finds a tagged key by the path toJS() keyed it under', () => {
    const { contents } = parseDocument('!!str 1.50: x\n')
    const node = nodeAtPath(contents, ['1.50'])
    expect(node?.kind === 'scalar' && node.value).toBe('x')
  })

  it('reads a !!timestamp without a time zone as UTC', () => {
    const date = valueOfA('a: !!timestamp 2001-12-14 21:59:43.10\n') as Date
    expect(date.toISOString()).toBe('2001-12-14T21:59:43.100Z')
    expect((valueOfA('a: !!timestamp 2002-12-14\n') as Date).toISOString()).toBe('2002-12-14T00:00:00.000Z')
    expect((valueOfA('a: !!timestamp "2002-12-14"\n') as Date).toISOString()).toBe('2002-12-14T00:00:00.000Z')
  })

  it('reads a !!timestamp the same way whatever time zone the host runs in', () => {
    // `new Date('2001-12-14 21:59:43.10')` is *local* time, so a UTC host (like
    // CI) cannot see the bug. A child process pinned to New York can.
    const module = fileURLToPath(new URL('./parse-document.ts', import.meta.url))
    const script = [
      `const { parseDocument } = await import(${JSON.stringify(module)})`,
      `const v = parseDocument('a: !!timestamp 2001-12-14 21:59:43.10\\nb: !!timestamp 2001-12-14\\n').toJS()`,
      'console.log(JSON.stringify([new Date(2001, 11, 14).getTimezoneOffset(), v.a.toISOString(), v.b.toISOString()]))',
    ].join('\n')
    const child = spawnSync('bun', ['-e', script], {
      env: { ...process.env, TZ: 'America/New_York' },
      encoding: 'utf8',
    })
    expect(child.stderr).toBe('')
    const [offset, a, b] = JSON.parse(child.stdout) as [number, string, string]
    // Proves the child really ran off UTC, so the assertions below mean something.
    expect(offset).toBe(300)
    expect(a).toBe('2001-12-14T21:59:43.100Z')
    expect(b).toBe('2001-12-14T00:00:00.000Z')
  })

  it('reads every !!timestamp spelling the YAML timestamp type defines', () => {
    const iso = (text: string): string => (valueOfA(`a: !!timestamp ${text}\n`) as Date).toISOString()
    expect(iso('2001-12-14t21:59:43.10-05:00')).toBe('2001-12-15T02:59:43.100Z')
    expect(iso('2001-12-14T21:59:43.10+05:30')).toBe('2001-12-14T16:29:43.100Z')
    expect(iso('2001-12-14 21:59:43.10 -5')).toBe('2001-12-15T02:59:43.100Z')
    expect(iso('2001-12-14 21:59:43.123456 Z')).toBe('2001-12-14T21:59:43.123Z')
    expect(iso('2001-1-2 3:04:05Z')).toBe('2001-01-02T03:04:05.000Z')
    expect(iso('2001-12-14T21:59:43Z')).toBe('2001-12-14T21:59:43.000Z')
    // A two-digit year is still that year, not 19xx.
    expect(iso('0099-01-01')).toBe('0099-01-01T00:00:00.000Z')
  })

  it('leaves a !!timestamp that is not a YAML timestamp as its text, with a warning', () => {
    for (const text of ['Dec 14 2001', '12/14/2001', '2001-02-30', '2001-13-01', '2001-12-14 25:00:00']) {
      const doc = parseDocument(`a: !!timestamp ${text}\n`)
      expect(doc.toJS()).toEqual({ a: text })
      expect(doc.errors).toEqual([])
      expect(doc.warnings.map((w) => w.code)).toEqual(['BAD_TAG_VALUE'])
    }
  })

  it('applies a core-schema tag only to text in that tag’s format', () => {
    const cases: [string, unknown][] = [
      ['!!int "12abc"', '12abc'],
      ['!!int 1.9', '1.9'],
      ['!!int .inf', '.inf'],
      ['!!int 1e3', '1e3'],
      ['!!int " 42 "', ' 42 '],
      ['!!float true', 'true'],
      ['!!float "abc"', 'abc'],
      ['!!null "x"', 'x'],
      ['!!null anything', 'anything'],
      ['!!bool yes', 'yes'],
      ['!!bool 5', '5'],
      ['!!bool', ''],
      ['!!int', ''],
    ]
    for (const [text, expected] of cases) {
      const doc = parseDocument(`a: ${text}\n`)
      expect(doc.toJS(), text).toEqual({ a: expected })
      expect(doc.errors, text).toEqual([])
      expect(
        doc.warnings.map((w) => w.code),
        text,
      ).toEqual(['BAD_TAG_VALUE'])
    }
  })

  it('points the tag warning at the scalar it could not apply to', () => {
    const doc = parseDocument('a: !!int "12abc"\n')
    expect(doc.warnings[0]).toMatchObject({ kind: 'warning', start: 9, end: 16 })
  })

  it('still applies a core-schema tag to every spelling in its format', () => {
    const cases: [string, unknown][] = [
      ['!!int "42"', 42],
      ['!!int 0x1F', 31],
      ['!!int "0o17"', 15],
      ['!!int -12', -12],
      ['!!float 3', 3],
      ['!!float "1e3"', 1000],
      ['!!float ".inf"', Number.POSITIVE_INFINITY],
      ['!!float -.INF', Number.NEGATIVE_INFINITY],
      ['!!float .nan', Number.NaN],
      ['!!null', null],
      ['!!null ~', null],
      ['!!null ""', null],
      ['!!null NULL', null],
      ['!!bool "True"', true],
      ['!!bool FALSE', false],
      ['!!str 1.50', '1.50'],
    ]
    for (const [text, expected] of cases) {
      const doc = parseDocument(`a: ${text}\n`)
      expect(doc.toJS(), text).toEqual({ a: expected })
      expect(doc.warnings, text).toEqual([])
    }
  })

  it('does not check custom or non-specific tags', () => {
    expect(warningCodes('a: !custom 12abc\nb: ! 12\n')).toEqual([])
    // A schema tag named after an `Object.prototype` member is still just unknown.
    expect(warningCodes('a: !!toString [1]\nb: !!constructor x\n')).toEqual([])
  })

  it('reports a merge source that is not a mapping', () => {
    const scalar = parseDocument('x:\n  <<: 5\n')
    expect(scalar.errors.map((e) => e.code)).toEqual(['BAD_MERGE'])
    expect(scalar.errors[0]).toMatchObject({ start: 9, end: 10 })
    // The projection still skips the source, exactly as before.
    expect(scalar.toJS()).toEqual({ x: {} })

    // One report per offending entry, each at its own position.
    const list = parseDocument('x:\n  <<: [1, {a: 1}, 2]\n')
    expect(list.errors.map((e) => [e.code, e.start])).toEqual([
      ['BAD_MERGE', 10],
      ['BAD_MERGE', 21],
    ])
    expect(list.toJS()).toEqual({ x: { a: 1 } })

    expect(errorCodes('x:\n  <<: ~\n')).toEqual(['BAD_MERGE'])
    expect(errorCodes('x:\n  <<: "str"\n')).toEqual(['BAD_MERGE'])
    expect(errorCodes('x:\n  <<: [[{a: 1}]]\n')).toEqual(['BAD_MERGE'])
    expect(errorCodes('x: {<<: 5}\n')).toEqual(['BAD_MERGE'])
  })

  it('reports a merge key with no value at the key', () => {
    const doc = parseDocument('x:\n  <<:\n  a: 1\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['BAD_MERGE'])
    expect(doc.errors[0]).toMatchObject({ start: 5, end: 7 })
  })

  it('follows aliases when checking a merge source', () => {
    expect(errorCodes('b: &b 5\nx:\n  <<: *b\n')).toEqual(['BAD_MERGE'])
    expect(errorCodes('b: &b {p: 1}\nx:\n  <<: *b\n')).toEqual([])
    expect(errorCodes('b: &b {p: 1}\nc: &c {q: 1}\nx:\n  <<: [*b, *c]\n')).toEqual([])
    expect(errorCodes('b: &b [{p: 1}]\nx:\n  <<: *b\n')).toEqual([])
    // A missing anchor is already reported as such; a second report adds nothing.
    expect(errorCodes('x:\n  <<: *nope\n')).toEqual(['UNRESOLVED_ALIAS'])
  })

  it('accepts empty merge sources and leaves non-merge << keys alone', () => {
    expect(errorCodes('x:\n  <<: {}\n')).toEqual([])
    expect(errorCodes('x:\n  <<: []\n')).toEqual([])
    expect(errorCodes('x:\n  "<<": 5\n')).toEqual([])
    expect(parseDocument('x:\n  <<: 5\n', { merge: false }).errors).toEqual([])
  })

  it('warns about a !!omap entry that is not a single-pair mapping or repeats a key', () => {
    const dup = parseDocument('a: !!omap [a: 1, a: 2]\n')
    expect(dup.errors).toEqual([])
    expect(dup.warnings.map((w) => [w.code, w.start])).toEqual([['BAD_TAG_VALUE', 17]])
    expect([...(dup.toJS() as { a: Map<unknown, unknown> }).a]).toEqual([['a', 2]])

    expect(warningCodes('a: !!omap [a, b: 1]\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!omap [{a: 1, b: 2}]\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!omap [a: 1, b: 2]\n')).toEqual([])
    // `!!pairs` is the ordered type that does allow a key to repeat.
    expect(warningCodes('a: !!pairs [a: 1, a: 2]\n')).toEqual([])
  })

  it('warns about a collection tag on the wrong kind of node', () => {
    expect(warningCodes('a: !!omap {a: 1}\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!set [a]\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!map [a]\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!seq {a: 1}\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!str [a]\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!map "x"\n')).toEqual(['BAD_TAG_VALUE'])
    expect(warningCodes('a: !!set {x, y}\nb: !!map {x: 1}\nc: !!seq [1]\n')).toEqual([])
    // A set's members are its keys; a value on one is data the projection drops.
    expect(warningCodes('a: !!set {x: 1}\n')).toEqual(['BAD_TAG_VALUE'])
  })

  it('warns about a !!binary payload that is not base64', () => {
    const doc = parseDocument('a: !!binary "not base64!"\n')
    expect(doc.warnings.map((w) => w.code)).toEqual(['BAD_TAG_VALUE'])
    expect(doc.toJS()).toEqual({ a: 'not base64!' })
    expect(warningCodes('a: !!binary aGVsbG8=\n')).toEqual([])
    expect(warningCodes('a: !!binary |\n  aGVsbG8g\n  d29ybGQ=\n')).toEqual([])
  })

  it('turns each empty line after an escaped line break into a line feed', () => {
    // `s-double-escaped(n) ::= s-white* "\" b-non-content l-empty(n,flow-in)*`:
    // the `\` eats its own break, but every empty line after it is still one
    // line feed, and the next content line joins with no space. PyYAML agrees.
    expect(parseDocument('"a\\\n\nb"\n').toJS()).toBe('a\nb')
    expect(parseDocument('"a\t\\\n\nb"\n').toJS()).toBe('a\t\nb')
    expect(parseDocument('"a\\\n\n\n  b"\n').toJS()).toBe('a\n\nb')
    expect(parseDocument('"a\\\n  \n b"\n').toJS()).toBe('a\nb')
    expect(parseDocument('"a\\\n\n\\\n\nb"\n').toJS()).toBe('a\n\nb')
    expect(parseDocument('"a \\\n  \n\n  b c"\n').toJS()).toBe('a \n\nb c')
    expect(parseDocument('"a\\\n\n"\n').toJS()).toBe('a\n')
    expect(parseDocument('"x\n\\\n\ny"\n').toJS()).toBe('x \ny')
  })

  it('still joins an escaped line break straight onto the next line', () => {
    expect(parseDocument('"a\\\n  b"\n').toJS()).toBe('ab')
    expect(parseDocument('"a\\\n"\n').toJS()).toBe('a')
    // The spec's own example 7.5.
    expect(parseDocument('"folded \nto a space,\t\n \nto a line feed, or \t\\\n \\ \tnon-content"\n').toJS()).toBe(
      'folded to a space,\nto a line feed, or \t \tnon-content',
    )
  })
})
