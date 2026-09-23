import { describe, expect, it } from 'vitest'

import { parseAllDocuments, parseDocument } from './parse-document'
import type { YamlMap, YamlSeq } from './types'

const codes = (source: string): string[] => parseDocument(source).errors.map((e) => e.code)

/** Asserts a document parses without a single diagnostic and returns its value. */
const clean = (source: string): unknown => {
  const doc = parseDocument(source)
  expect(doc.errors, JSON.stringify(source)).toEqual([])
  return doc.toJS()
}

describe('flow-and-indicators', () => {
  it('keeps an explicit flow-sequence key with no ":" as a single-pair mapping', () => {
    // `[ ? a ]` is `ns-flow-pair` with an empty value, not the bare scalar `a` —
    // `yaml` (eemeli) and `js-yaml` both read it as `[{ a: null }]`.
    expect(clean('[ ? a ]\n')).toEqual([{ a: null }])
    expect(clean('[ ? a, b ]\n')).toEqual([{ a: null }, 'b'])
    expect(clean('[ ? a\n , b]\n')).toEqual([{ a: null }, 'b'])
    expect(clean('a: [? a, ? b: c]\n')).toEqual({ a: [{ a: null }, { b: 'c' }] })
  })

  it('keeps a bare flow-sequence "?" as a pair with an empty key', () => {
    expect(clean('[ ? ]\n')).toEqual([{ '': null }])
    expect(clean('[? a, ? ]\n')).toEqual([{ a: null }, { '': null }])
    const seq = parseDocument('[ ? ]\n').contents as YamlSeq
    const map = seq.items[0] as YamlMap
    expect(map.kind).toBe('map')
    expect(map.items[0]?.key).toMatchObject({ kind: 'scalar', value: null })
    expect(map.items[0]?.value).toBeNull()
  })

  it('rejects a block value that starts with a flow indicator or a reserved one', () => {
    for (const [source, at] of [
      ['a: ]\n', 3],
      ['a: }\n', 3],
      ['a: ,x\n', 3],
      ['a: %x\n', 3],
      ['a: @x\n', 3],
      ['a: `x\n', 3],
      ['- ]\n', 2],
      ['- , \n', 2],
      [']\n', 0],
      [',\n', 0],
      ['a: !!str %x\n', 9],
    ] as const) {
      const errors = parseDocument(source).errors
      expect(
        errors.map((e) => [e.code, e.start, e.end]),
        JSON.stringify(source),
      ).toEqual([['BAD_SCALAR_START', at, at + 1]])
    }
  })

  it('rejects a block mapping key that starts with an indicator', () => {
    for (const [source, at] of [
      ['k: 1\n>k: 1\n', 5],
      ['k: 1\n|k: 1\n', 5],
      ['k: 1\n]k: 1\n', 5],
      ['k: 1\n}k: 1\n', 5],
      ['k: 1\n,k: 1\n', 5],
      ['k: 1\n%k: 1\n', 5],
      ['k: 1\n@k: 1\n', 5],
      ['a:\n  k: 1\n  ]k: 1\n', 12],
    ] as const) {
      const errors = parseDocument(source).errors
      expect(
        errors.map((e) => [e.code, e.start, e.end]),
        JSON.stringify(source),
      ).toEqual([['BAD_SCALAR_START', at, at + 1]])
    }
  })

  it('rejects a flow entry that starts with an indicator', () => {
    for (const [source, at] of [
      ['[|]\n', 1],
      ['[>]\n', 1],
      ['[%]\n', 1],
      ['[@x]\n', 1],
      ['{a: |}\n', 4],
      ['[a, %b]\n', 4],
    ] as const) {
      const errors = parseDocument(source).errors
      expect(
        errors.map((e) => [e.code, e.start, e.end]),
        JSON.stringify(source),
      ).toEqual([['BAD_SCALAR_START', at, at + 1]])
    }
  })

  it('rejects a "?" that is not followed by plain-scalar content', () => {
    // A `?` only starts a plain scalar when an `ns-plain-safe` character follows it.
    // Followed by white space it is the explicit-key indicator, which an implicit
    // key's value cannot open with; followed by a flow indicator it is neither.
    expect(codes('a: ?\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('a: ? x\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('[?]\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('{?}\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('[?, a]\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('[a: ?]\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('{a: ? }\n')).toEqual(['BAD_SCALAR_START'])
    expect(codes('[? ? a]\n')).toEqual(['BAD_SCALAR_START'])
    const errors = parseDocument('a: ?\n').errors
    expect([errors[0]?.start, errors[0]?.end]).toEqual([3, 4])
  })

  it('reads an explicit key opened on another explicit-entry line as a nested mapping', () => {
    // `: ? b` is `ns-l-compact-mapping` whose first entry is itself explicit —
    // valid YAML, which used to fold into the plain scalar `"? b"`.
    expect(clean('? a\n: ? b\n')).toEqual({ a: { b: null } })
    expect(clean('? a\n: ? b\n  : c\n')).toEqual({ a: { b: 'c' } })
    const doc = parseDocument('? ? a\n')
    expect(doc.errors).toEqual([])
    const outer = doc.contents as YamlMap
    expect(outer.items[0]?.key).toMatchObject({ kind: 'map' })
    const inner = outer.items[0]?.key as YamlMap
    expect(inner.items[0]?.key).toMatchObject({ kind: 'scalar', value: 'a' })
  })

  it('still accepts plain scalars that start with "-", "?" or ":" followed by content', () => {
    expect(clean('-1\n')).toBe(-1)
    expect(clean('-x\n')).toBe('-x')
    expect(clean('?x\n')).toBe('?x')
    expect(clean(':x\n')).toBe(':x')
    expect(clean('a: -1\n')).toEqual({ a: -1 })
    expect(clean('a: ?x\n')).toEqual({ a: '?x' })
    expect(clean('a: :x\n')).toEqual({ a: ':x' })
    expect(clean('a: -:x\n')).toEqual({ a: '-:x' })
    expect(clean(':: x\n')).toEqual({ ':': 'x' })
    expect(clean('?x: 1\n-y: 2\n:z: 3\n')).toEqual({ '?x': 1, '-y': 2, ':z': 3 })
    expect(clean('- -\n')).toEqual([[null]])
    expect(clean('- ?x\n')).toEqual(['?x'])
    expect(clean('[-x, ?x, :x, a?b]\n')).toEqual(['-x', '?x', ':x', 'a?b'])
    expect(clean('{?x: 1}\n')).toEqual({ '?x': 1 })
  })

  it('still accepts indicators that do not open the scalar', () => {
    expect(clean('a: x%y\n')).toEqual({ a: 'x%y' })
    expect(clean('a: x]\n')).toEqual({ a: 'x]' })
    expect(clean('a: x, y\n')).toEqual({ a: 'x, y' })
    expect(clean('a: x @y `z\n')).toEqual({ a: 'x @y `z' })
    // A `%` opening a *continuation* line is ordinary content (suite case XLQ9).
    expect(clean('a\n%b\n')).toBe('a %b')
    expect(clean('k: a\n  %b\n')).toEqual({ k: 'a %b' })
    expect(clean('k: a\n  ]b\n')).toEqual({ k: 'a ]b' })
  })

  it('ends a flow plain key at a ":" glued to a flow collection', () => {
    // `ns-plain-char` admits a `:` only when an `ns-plain-safe` character follows,
    // and in flow context `[`/`{` are not — so the `:` is the value indicator.
    expect(clean('{a:{b: 1}}\n')).toEqual({ a: { b: 1 } })
    expect(clean('{a:[1]}\n')).toEqual({ a: [1] })
    expect(clean('[a:[1]]\n')).toEqual([{ a: [1] }])
    expect(clean('[a:{}]\n')).toEqual([{ a: {} }])
    expect(clean('{a :{b: 1}}\n')).toEqual({ a: { b: 1 } })
    expect(clean('{a::{b: 1}}\n')).toEqual({ 'a:': { b: 1 } })
    expect(clean('{http://x:{a}}\n')).toEqual({ 'http://x': { a: null } })
    expect(clean('x: {a:{b: 1}, c:[2]}\n')).toEqual({ x: { a: { b: 1 }, c: [2] } })
  })

  it('keeps a ":" glued to plain content inside the flow plain scalar', () => {
    expect(clean('{a:1}\n')).toEqual({ 'a:1': null })
    expect(clean('{a:b}\n')).toEqual({ 'a:b': null })
    expect(clean('[a:b]\n')).toEqual(['a:b'])
    expect(clean('{a:}\n')).toEqual({ a: null })
    expect(clean('{"a":1}\n')).toEqual({ a: 1 })
    expect(clean('{"a":{"b":[1]}}\n')).toEqual({ a: { b: [1] } })
  })

  it('ends a wrapped flow plain key at a line opening on ":" and a flow collection', () => {
    expect(clean('{a\n :{b: 1}}\n')).toEqual({ a: { b: 1 } })
  })

  it('rejects a quoted scalar in a flow collection continued at its block parent column', () => {
    expect(codes('a: ["x\ny"]\n')).toEqual(['BAD_INDENT'])
    expect(codes("a: ['x\ny']\n")).toEqual(['BAD_INDENT'])
    expect(codes('a:\n  b: ["x\n  y"]\n')).toEqual(['BAD_INDENT'])
    expect(codes('- ["x\ny"]\n')).toEqual(['BAD_INDENT'])
    // The closing quote is scalar content, not a closing bracket, so it gets none
    // of the leniency `]` does — `yaml` (eemeli) rejects it too.
    expect(codes('a: ["x\n"]\n')).toEqual(['BAD_INDENT'])
    const errors = parseDocument('a: ["x\ny"]\n').errors
    expect([errors[0]?.start, errors[0]?.end]).toEqual([7, 7])
  })

  it('rejects a plain scalar in a flow collection continued at its block parent column', () => {
    expect(codes('a: {b: c\nd}\n')).toEqual(['BAD_INDENT'])
    expect(codes('- [a\nb]\n')).toEqual(['BAD_INDENT'])
    expect(codes('a:\n  b: [x\n  y]\n')).toEqual(['BAD_INDENT'])
    const errors = parseDocument('a: {b: c\nd}\n').errors
    expect([errors[0]?.start, errors[0]?.end]).toEqual([9, 9])
  })

  it('reports a mis-indented flow collection once, however its lines are split', () => {
    expect(codes('a: ["x\ny",\nz]\n')).toEqual(['BAD_INDENT'])
    expect(codes('a: [x\ny,\nz]\n')).toEqual(['BAD_INDENT'])
  })

  it('accepts flow scalars continued deeper than their block parent', () => {
    expect(clean('a: ["x\n  y"]\n')).toEqual({ a: ['x y'] })
    expect(clean('a: ["x\n\n  y"]\n')).toEqual({ a: ['x\ny'] })
    expect(clean('a: ["x\n "]\n')).toEqual({ a: ['x '] })
    expect(clean('a: {b: c\n d}\n')).toEqual({ a: { b: 'c d' } })
    expect(clean('- [a\n  b]\n')).toEqual([['a b']])
    expect(clean('a: [x\n]\n')).toEqual({ a: ['x'] })
    expect(clean('a:\n  [x,\n  y]\n')).toEqual({ a: ['x', 'y'] })
  })

  it('does not hold a root flow collection to any indentation', () => {
    expect(clean('["x\ny"]\n')).toEqual(['x y'])
    expect(clean('{a: b\nc}\n')).toEqual({ a: 'b c' })
    expect(clean('{\n\t"a": "x\ny",\n\t"b": [1,\n2]\n}\n')).toEqual({ a: 'x y', b: [1, 2] })
    expect(clean('{\r\n  "a": [\r\n    "x"\r\n  ]\r\n}\r\n')).toEqual({ a: ['x'] })
  })

  it('holds an escaped line break to the continuation indentation rule', () => {
    // `\` then a line break is a continuation that joins the lines, but the next
    // line is still a continuation line of the scalar and owes its indentation.
    expect(codes('k: "a\\\nb"\n')).toEqual(['BAD_INDENT'])
    expect(codes('k: "a\\\r\nb"\r\n')).toEqual(['BAD_INDENT'])
    expect(parseDocument('k: "a\\\nb"\n').toJS()).toEqual({ k: 'ab' })
    const errors = parseDocument('k: "a\\\nb"\n').errors
    expect([errors[0]?.start, errors[0]?.end]).toEqual([7, 7])
    expect(codes('a: ["x\\\ny"]\n')).toEqual(['BAD_INDENT'])
  })

  it('treats an escaped line break the same with LF and CRLF', () => {
    for (const source of [
      'k: "a\\\n  b"\n',
      'k: "a\\\n  \\ b"\n',
      'k: "a \\\n\n  b"\n',
      '"a\\\nb"\n',
      'k: "a\\\nb"\n',
    ]) {
      const lf = parseDocument(source)
      const crlf = parseDocument(source.replaceAll('\n', '\r\n'))
      expect(crlf.toJS(), JSON.stringify(source)).toEqual(lf.toJS())
      expect(
        crlf.errors.map((e) => e.code),
        JSON.stringify(source),
      ).toEqual(lf.errors.map((e) => e.code))
    }
    expect(clean('k: "a\\\n  b"\n')).toEqual({ k: 'ab' })
    expect(clean('k: "a\\\r\n  b"\r\n')).toEqual({ k: 'ab' })
    expect(clean('- "a\\\n  b"\n')).toEqual(['ab'])
  })

  it('ends an unterminated double-quoted scalar at a document marker after an escaped line break', () => {
    const docs = parseAllDocuments('"a\\\n---\nb"\n')
    expect(docs[0]?.errors.map((e) => e.code)).toContain('UNTERMINATED_QUOTE')
    expect(docs.length).toBe(2)
    expect(docs[0]?.contents?.end).toBe(4)
    const ended = parseAllDocuments('"a\\\n...\nb"\n')
    expect(ended[0]?.errors.map((e) => e.code)).toContain('UNTERMINATED_QUOTE')
    expect(ended[0]?.contents?.end).toBe(4)
  })
})
