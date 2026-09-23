import { describe, expect, it } from 'vitest'

import { nodeAtPath } from './node-at-path'
import { keyText, parseAllDocuments, parseDocument } from './parse-document'
import type { YamlMap, YamlNode, YamlScalar } from './types'

const codes = (problems: { code: string }[]): string[] => problems.map((p) => p.code)

/** A plain scalar node, for the tests that edit a tree in place. */
const scalar = (value: string): YamlScalar => ({
  kind: 'scalar',
  value,
  source: value,
  style: 'plain',
  start: 0,
  end: 0,
})

describe('review-fixes', () => {
  it('bounds a chain of compact explicit keys by the nesting limit instead of throwing', () => {
    // `? ? ? … a` nests a mapping per `?` without ever passing through
    // `parseNode`, so the depth guard never saw it and 100k levels overflowed
    // the native stack — a `RangeError` out of a function that promises not to throw.
    const deep = '? '.repeat(100_000)
    for (const source of [
      `${deep}a\n`,
      `? a\n: ${deep}b`,
      `${deep}[a]`,
      `k:\n  ${deep}a`,
      `${'- ? '.repeat(50_000)}a\n`,
    ]) {
      const started = performance.now()
      const doc = parseDocument(source)
      expect(codes(doc.errors)).toContain('DEPTH_LIMIT')
      const all = parseAllDocuments(source)
      expect(all.flatMap((d) => codes(d.errors))).toContain('DEPTH_LIMIT')
      expect(performance.now() - started).toBeLessThan(1_000)
    }
  })

  it('parses compact explicit keys nested just under the limit, in linear time', () => {
    const chain = (leaf: string): string => `${'? '.repeat(900)}${leaf}`
    const doc = parseDocument(`${chain('a')}\n`)
    expect(doc.errors).toEqual([])
    let node: YamlNode | null = doc.contents
    let depth = 0
    while (node !== null && node.kind === 'map') {
      node = node.items[0]?.key ?? null
      depth++
    }
    expect(depth).toBe(900)
    expect(node).toMatchObject({ kind: 'scalar', value: 'a' })

    // Every level used to render the whole chain below it as a key, making one
    // chain quadratic in its depth: 400 of them took tens of seconds.
    const many = Array.from({ length: 400 }, (_, i) => chain(`a${i}`)).join('\n')
    const started = performance.now()
    const wide = parseDocument(`${many}\n`)
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(wide.errors).toEqual([])
    expect((wide.contents as YamlMap).items).toHaveLength(400)
  })

  it('does not read a flow collection after a root property as a block mapping', () => {
    for (const [source, value] of [
      ['\t&x {a: b}\n', { a: 'b' }],
      ['\t!!map {a: 1}\n', { a: 1 }],
      ['--- &x {a: b}\n', { a: 'b' }],
      ['--- &x "a: b"\n', 'a: b'],
    ] as const) {
      const doc = parseDocument(source)
      expect(doc.errors).toEqual([])
      expect(doc.toJS()).toEqual(value)
    }
    const omap = parseDocument('--- !!omap [a: 1]\n')
    expect(omap.errors).toEqual([])
    expect(omap.toJS()).toEqual(new Map([['a', 1]]))
    // A real block mapping behind the property is still the mistake it was.
    expect(codes(parseDocument('\t&x a: b\n').errors)).toEqual(['TAB_INDENT'])
    expect(codes(parseDocument('--- &x a: b\n').errors)).toEqual(['UNEXPECTED_CONTENT'])
  })

  it('reads node properties in front of a compact mapping opened on an introducer line', () => {
    for (const [source, value] of [
      ['? a\n: &x b: c\n', { a: { b: 'c' } }],
      ['? a\n: !!str b: c\n', { a: { b: 'c' } }],
      ['? a\n: &x {b: c}\n', { a: { b: 'c' } }],
      ['? a\n: &x "b: c"\n', { a: 'b: c' }],
      ['? &x {a: b}\n', { '{ a: b }': null }],
      ['? &x b: c\n: 1\n', { '{ b: c }': 1 }],
    ] as const) {
      const doc = parseDocument(source)
      expect(doc.errors).toEqual([])
      expect(doc.toJS()).toEqual(value)
    }
  })

  it('anchors the first key of a compact mapping, as it does at the head of a line', () => {
    // The package's rule (and `yaml`'s): properties on the first key's line describe the key.
    expect(parseDocument('? a\n: &x b: c\n? z\n: *x\n').toJS()).toEqual({ a: { b: 'c' }, z: 'b' })
    expect(parseDocument('? &x b: c\n: 1\n? z\n: *x\n').toJS()).toEqual({ '{ b: c }': 1, z: 'b' })
  })

  it('reports a merge of a set or an ordered map, which the projection cannot fold in', () => {
    const set = parseDocument('a: &a !!set {x}\nc:\n  <<: *a\n')
    expect(codes(set.errors)).toEqual(['BAD_MERGE'])
    expect(set.errors[0]).toMatchObject({ start: 25, end: 27 })
    const omap = parseDocument('a: &a !!omap [{x: 1}]\nc:\n  <<: *a\n')
    expect(codes(omap.errors)).toEqual(['BAD_MERGE'])
    const inList = parseDocument('a: &a !!set {x}\nb: &b {y: 1}\nc:\n  <<: [*b, *a]\n')
    expect(codes(inList.errors)).toEqual(['BAD_MERGE'])
    expect(inList.errors[0]).toMatchObject({ start: 43, end: 45 })
  })

  it('merges through a chain of aliases without a false report', () => {
    const doc = parseDocument('a: &a {x: 1}\nb: &b *a\nc:\n  <<: *b\n')
    // The anchor on an alias is its own error; the merge itself is fine.
    expect(codes(doc.errors)).toEqual(['BAD_PROPERTY'])
    expect(doc.toJS()).toMatchObject({ c: { x: 1 } })
  })

  it('still merges a !!pairs sequence, which projects to a list of mappings', () => {
    const doc = parseDocument('a: &a !!pairs [{x: 1}]\nc:\n  <<: *a\n')
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toMatchObject({ c: { x: 1 } })
  })

  it('accepts the end-of-day hour 24 in a timestamp only at 24:00:00', () => {
    for (const time of ['24:00:00Z', '24:00:00.000Z', '24:00:00']) {
      const doc = parseDocument(`a: !!timestamp 2001-12-14T${time}\n`)
      expect(doc.warnings).toEqual([])
      expect(doc.toJS()).toEqual({ a: new Date('2001-12-15T00:00:00.000Z') })
    }
    for (const time of ['24:00:01Z', '24:01:00Z', '24:00:00.5Z', '24:00:60Z']) {
      const doc = parseDocument(`a: !!timestamp 2001-12-14T${time}\n`)
      expect(codes(doc.warnings)).toEqual(['BAD_TAG_VALUE'])
      expect(doc.toJS()).toEqual({ a: `2001-12-14T${time}` })
    }
  })

  it('rejects a timestamp zone offset outside a clock range', () => {
    for (const zone of ['+99:99', '+24', '-05:60']) {
      const doc = parseDocument(`a: !!timestamp 2001-12-14T21:59:43${zone}\n`)
      expect(codes(doc.warnings)).toEqual(['BAD_TAG_VALUE'])
    }
    const edge = parseDocument('a: !!timestamp 2001-12-14T21:59:43+23:59\n')
    expect(edge.warnings).toEqual([])
    expect(edge.toJS()).toEqual({ a: new Date('2001-12-13T22:00:43.000Z') })
  })

  it('keys a !!binary scalar by its base64 text', () => {
    const doc = parseDocument('!!binary AQID: a\n"1,2,3": b\n')
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toEqual({ AQID: 'a', '1,2,3': 'b' })
    const key = (doc.contents as YamlMap).items[0]?.key
    expect(key && keyText(key)).toBe('AQID')
    // Two spellings of the same payload still collide, as their projected keys do.
    expect(codes(parseDocument('!!binary AQID: a\nAQID: b\n').errors)).toEqual(['DUPLICATE_KEY'])
  })

  it('sees a pair replaced in place in a wide mapping, as in a narrow one', () => {
    for (const width of [4, 20]) {
      const source = Array.from({ length: width }, (_, i) => `k${i}: v${i}`).join('\n')
      const map = parseDocument(source).contents as YamlMap
      expect(nodeAtPath(map, ['k3'])).toMatchObject({ value: 'v3' })
      map.items[3] = { kind: 'pair', key: scalar('k3'), value: scalar('replaced'), start: 0, end: 0 }
      expect(nodeAtPath(map, ['k3'])).toMatchObject({ value: 'replaced' })
      map.items[2] = { kind: 'pair', key: scalar('fresh'), value: scalar('new'), start: 0, end: 0 }
      expect(nodeAtPath(map, ['k2'])).toBeUndefined()
      expect(nodeAtPath(map, ['fresh'])).toMatchObject({ value: 'new' })
    }
  })

  it('sees a key renamed in place in a wide mapping, as in a narrow one', () => {
    for (const width of [4, 20]) {
      const source = Array.from({ length: width }, (_, i) => `k${i}: v${i}`).join('\n')
      const map = parseDocument(source).contents as YamlMap
      expect(nodeAtPath(map, ['k1'])).toMatchObject({ value: 'v1' })
      const key = map.items[1]?.key as YamlScalar
      key.value = 'renamed'
      key.source = 'renamed'
      expect(nodeAtPath(map, ['k1'])).toBeUndefined()
      expect(nodeAtPath(map, ['renamed'])).toMatchObject({ value: 'v1' })
      expect(nodeAtPath(map, ['k0'])).toMatchObject({ value: 'v0' })
    }
  })

  it('does not warn about an explicitly empty document after the first', () => {
    for (const source of ['a: 1\n...\n---\n', 'a: 1\n---\n---\n', 'a: 1\n...\n---\n# note\n...\n\n---\n']) {
      const doc = parseDocument(source)
      expect(doc.warnings).toEqual([])
      expect(doc.errors).toEqual([])
    }
    for (const source of [
      'a: 1\n...\n---\nb: 2\n',
      'a: 1\n---\n---\nb\n',
      'a: 1\n...\n--- b\n',
      'a: 1\n---\n...\n%YAML 1.2\n---\n',
    ]) {
      expect(codes(parseDocument(source).warnings)).toEqual(['MULTIPLE_DOCUMENTS'])
    }
  })

  it('points a warning about an empty tagged scalar at the tag', () => {
    expect(parseDocument('a: !!bool\n').warnings).toMatchObject([{ code: 'BAD_TAG_VALUE', start: 3, end: 9 }])
    expect(parseDocument('a: !!int\n').warnings).toMatchObject([{ code: 'BAD_TAG_VALUE', start: 3, end: 8 }])
    expect(parseDocument('a: !!map\n').warnings).toMatchObject([{ code: 'BAD_TAG_VALUE', start: 3, end: 8 }])
    expect(parseDocument('- !!int &x\n- 1\n').warnings).toMatchObject([{ code: 'BAD_TAG_VALUE', start: 2, end: 7 }])
  })

  it('reports a tab in front of a compact explicit key', () => {
    for (const [source, start] of [
      ['? a\n:\t? b\n', 5],
      ['?\t? a\n', 1],
      ['- \t? a', 2],
    ] as const) {
      const doc = parseDocument(source)
      expect(doc.errors).toMatchObject([{ code: 'TAB_INDENT', start }])
    }
    // A tab in front of a scalar is still ordinary separation.
    expect(parseDocument('? a\n:\tb\n').errors).toEqual([])
    expect(parseDocument('-\t?x\n').errors).toEqual([])
  })

  it('reads an indented % line as content rather than a directive', () => {
    const doc = parseDocument(' %x: 1\n')
    expect(codes(doc.errors)).toEqual(['BAD_SCALAR_START'])
    expect(doc.errors[0]).toMatchObject({ start: 1, end: 2 })
    expect(doc.warnings).toEqual([])
    expect(doc.toJS()).toEqual({ '%x': 1 })

    const yaml = parseDocument(' %YAML 1.2\n---\na\n')
    expect(codes(yaml.errors)).toEqual(['BAD_SCALAR_START'])
    expect(yaml.toJS()).toBe('%YAML 1.2')
    // A directive at column 0 is still one.
    const real = parseDocument('%YAML 1.2\n---\na\n')
    expect(real.errors).toEqual([])
    expect(real.toJS()).toBe('a')
  })
})
