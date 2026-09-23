import { describe, expect, it } from 'vitest'

import { parseDocument } from './parse-document'

/** `code@start-end` for every error, which pins both what was reported and where. */
const errorsOf = (source: string, options: { merge?: boolean } = {}): string[] =>
  parseDocument(source, options).errors.map((e) => `${e.code}@${e.start}-${e.end}`)

const codesOf = (source: string, options: { merge?: boolean } = {}): string[] =>
  parseDocument(source, options).errors.map((e) => e.code)

describe('block-keys', () => {
  it('reports text between a quoted key and its colon', () => {
    // `yaml` (eemeli) and `js-yaml` both reject these; the `b` used to vanish.
    expect(errorsOf('"a"b: 1\n')).toEqual(['UNEXPECTED_CONTENT@3-4'])
    expect(parseDocument('"a"b: 1\n').toJS()).toEqual({ a: 1 })
    expect(errorsOf("'a'b: 1\n")).toEqual(['UNEXPECTED_CONTENT@3-4'])
    // A `#` glued to the key is not a comment, so it is junk too.
    expect(errorsOf('"a"#: 1\n')).toEqual(['UNEXPECTED_CONTENT@3-4'])
  })

  it('reports node properties written between a quoted key and its colon', () => {
    // The anchor used to be dropped without a word, so the alias below it was
    // the only thing reported — as an unresolved alias, not the real mistake.
    expect(codesOf('"a" &x : 1\nb: *x\n')[0]).toBe('UNEXPECTED_CONTENT')
    expect(errorsOf('"a" &x : 1\nb: *x\n')[0]).toBe('UNEXPECTED_CONTENT@4-6')
    expect(errorsOf('"a" !!str : 1\n')).toEqual(['UNEXPECTED_CONTENT@4-9'])
  })

  it('reports text after a quoted key on a later entry of the mapping', () => {
    expect(errorsOf('x: 1\n"a"b: 1\n')).toEqual(['UNEXPECTED_CONTENT@8-9'])
    expect(errorsOf('x: 1\n"a" &y c : 1\n')).toEqual(['UNEXPECTED_CONTENT@9-13'])
    expect(errorsOf('- "a"b: 1\n')).toEqual(['UNEXPECTED_CONTENT@5-6'])
  })

  it('reports text after an alias or flow-collection key on a later entry', () => {
    expect(errorsOf('x: 1\n[a] y: 1\n')).toEqual(['UNEXPECTED_CONTENT@9-10'])
    expect(errorsOf('&a a: 1\n*a x: 1\n')).toEqual(['DUPLICATE_KEY@8-10', 'UNEXPECTED_CONTENT@11-12'])
  })

  it('accepts whitespace between a quoted key and its colon', () => {
    expect(errorsOf('"a"  : 1\n')).toEqual([])
    expect(errorsOf('"a"\t: 1\n')).toEqual([])
    expect(errorsOf('x: 1\n"a" : 1\n\'b\' : 2\n')).toEqual([])
    expect(parseDocument('x: 1\n"a" : 1\n').toJS()).toEqual({ x: 1, a: 1 })
    // An alias whose name swallows the colon (`*a:` aliases the anchor `a:`)
    // reaches past the separator; that is a duplicate `k`, not stray content.
    expect(errorsOf('&a: k: 1\n*a: 2\n')).toEqual(['DUPLICATE_KEY@9-12'])
  })

  it('leaves quoted keys in flow mappings alone', () => {
    const doc = parseDocument('{"a": 1, "b" : 2, \'c\' :3}\n')
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('accepts more than one << merge key in a mapping', () => {
    // A common docker-compose / CI shape; `yaml` and `js-yaml` accept both.
    const flat = parseDocument('<<: {a: 1}\n<<: {b: 2}\n')
    expect(flat.errors).toEqual([])
    expect(flat.toJS()).toEqual({ a: 1, b: 2 })
    const nested = parseDocument('base: &b {a: 1}\nx:\n  <<: *b\n  <<: {c: 3}\n')
    expect(nested.errors).toEqual([])
    expect(nested.toJS()).toEqual({ base: { a: 1 }, x: { a: 1, c: 3 } })
  })

  it('accepts repeated << merge keys in a flow mapping and in a large mapping', () => {
    expect(errorsOf('{<<: {a: 1}, <<: {b: 2}}\n')).toEqual([])
    // Past the size where duplicate tracking switches to a `Set`.
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}: ${i}\n`).join('')
    expect(errorsOf(`${keys}<<: {a: 1}\n<<: {b: 2}\n<<: {c: 3}\n`)).toEqual([])
    expect(errorsOf(`<<: {a: 1}\n${keys}<<: {b: 2}\n`)).toEqual([])
  })

  it('still reports a duplicated quoted "<<" key, and does not confuse it with a merge key', () => {
    // A quoted `<<` is an ordinary string key, never a merge.
    expect(errorsOf('"<<": 1\n"<<": 2\n')).toEqual(['DUPLICATE_KEY@8-12'])
    expect(errorsOf('"<<": 1\n<<: {a: 1}\n')).toEqual([])
    expect(errorsOf('<<: {a: 1}\n"<<": 1\n')).toEqual([])
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}: ${i}\n`).join('')
    expect(errorsOf(`<<: {a: 1}\n${keys}"<<": 1\n`)).toEqual([])
  })

  it('tracks << as an ordinary key when merging is off', () => {
    expect(codesOf('<<: {a: 1}\n<<: {b: 2}\n', { merge: false })).toEqual(['DUPLICATE_KEY'])
  })

  it('reports an anchor name holding a flow indicator, and parses the collection after it', () => {
    // `yaml` (eemeli) reads `&x{b: 1}` the same way: an anchor `x` glued to a flow mapping.
    const doc = parseDocument('a: &x{b: 1}\nc: *x\n')
    expect(doc.errors.map((e) => `${e.code}@${e.start}-${e.end}`)).toEqual(['BAD_ANCHOR@3-6'])
    expect(doc.warnings).toEqual([])
    expect(doc.toJS()).toEqual({ a: { b: 1 }, c: { b: 1 } })
    expect(parseDocument('a: &x[1]\n').toJS()).toEqual({ a: [1] })
    expect(codesOf('a: &x[1]\n')).toEqual(['BAD_ANCHOR'])
    expect(codesOf('a: &x,y 1\n')).toEqual(['BAD_ANCHOR'])
    expect(codesOf('a: &x]y 1\n')).toEqual(['BAD_ANCHOR'])
  })

  it('reports an anchor glued to a flow-collection key and keeps the key', () => {
    expect(parseDocument('&x[a]: 1\n').toJS()).toEqual({ '[ a ]': 1 })
    expect(codesOf('&x[a]: 1\n')).toEqual(['BAD_ANCHOR'])
    expect(parseDocument('b: 1\n&x[a]: 1\n').toJS()).toEqual({ b: 1, '[ a ]': 1 })
    expect(codesOf('b: 1\n&x[a]: 1\n')).toEqual(['BAD_ANCHOR'])
  })

  it('reports an empty anchor name', () => {
    expect(errorsOf('a: & x\n')).toEqual(['BAD_ANCHOR@3-4'])
    expect(parseDocument('a: & x\n').toJS()).toEqual({ a: 'x' })
    expect(errorsOf('a: &{b: 1}\n')).toEqual(['BAD_ANCHOR@3-4'])
    expect(parseDocument('a: &{b: 1}\n').toJS()).toEqual({ a: { b: 1 } })
    expect(parseDocument('a: &[1]\n').toJS()).toEqual({ a: [1] })
    expect(codesOf('- &\n')).toEqual(['BAD_ANCHOR'])
    expect(codesOf('[&, 1]\n')).toEqual(['BAD_ANCHOR'])
  })

  it('reports an empty alias name instead of an unresolved alias', () => {
    expect(errorsOf('a: *\n')).toEqual(['BAD_ANCHOR@3-4'])
    expect(errorsOf('[*]\n')).toEqual(['BAD_ANCHOR@1-2'])
  })

  it('ends an alias name at a flow indicator', () => {
    const doc = parseDocument('&x a: 1\nb: *x{\n')
    expect(doc.errors.map((e) => e.code)).toEqual(['UNEXPECTED_CONTENT'])
    expect(doc.errors[0]?.start).toBe(13)
  })

  it('keeps anchors that sit correctly before flow indicators in flow context', () => {
    // Both reference parsers accept these, and in flow context the indicator ends the name.
    expect(errorsOf('[&x, 1]\n')).toEqual([])
    expect(errorsOf('[&x]\n')).toEqual([])
    expect(errorsOf('{&x : 1}\n')).toEqual([])
    expect(errorsOf('{a: &x}\n')).toEqual([])
    expect(errorsOf('[&x[1]]\n')).toEqual([])
    expect(parseDocument('a: &x\n  b: 1\nc: *x\n').toJS()).toEqual({ a: { b: 1 }, c: { b: 1 } })
  })

  it('does not report a tab before a comment as compact indentation', () => {
    // A `#` after whitespace opens a comment, so no compact collection follows.
    expect(errorsOf('- \t#k: x\n')).toEqual([])
    expect(parseDocument('- \t#k: x\n').toJS()).toEqual([null])
    expect(errorsOf('? \t#k: x\n')).toEqual([])
    expect(errorsOf('? a\n: \t#k: x\n')).toEqual([])
    expect(errorsOf(': \t#k\n')).toEqual([])
    expect(errorsOf('-\t# - x\n')).toEqual([])
  })

  it('still reports a tab before a compact collection', () => {
    expect(errorsOf('- \t- x\n')).toEqual(['TAB_INDENT@2-3'])
    expect(errorsOf('-\tb: 1\n')).toEqual(['TAB_INDENT@1-2'])
  })

  it('reports node properties written before an explicit key indicator', () => {
    // `yaml` (eemeli) reports BAD_PROP_ORDER for all of these.
    expect(errorsOf('&x ? a\n')).toEqual(['BAD_PROPERTY@3-4'])
    expect(errorsOf('!t ? a\n')).toEqual(['BAD_PROPERTY@3-4'])
    expect(errorsOf('- &x ? a\n')).toEqual(['BAD_PROPERTY@5-6'])
    expect(errorsOf('a: 1\n&x ? b\n')).toEqual(['BAD_PROPERTY@8-9'])
    expect(parseDocument('&x ? a\n').toJS()).toEqual({ a: null })
  })

  it('accepts node properties on their own line above an explicit key', () => {
    expect(errorsOf('&x\n? a\n')).toEqual([])
    expect(errorsOf('? &x a\n: *x\n')).toEqual([])
    expect(parseDocument('? &x a\n: *x\n').toJS()).toEqual({ a: 'a' })
  })
})
