import { describe, expect, it } from 'vitest'

import { lineCounter } from './line-counter'
import { nodeAtPath } from './node-at-path'
import { parseAllDocuments, parseDocument } from './parse-document'

/**
 * Edges of the public options and helpers that the README documents but no
 * other test pinned: the `merge: false` switch, how `nodeAtPath` treats merge
 * keys and number segments, `lineCounter` on a `NaN` offset, and comment
 * collection across a multi-document stream.
 */

const MERGE_SOURCE = 'base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\n'
const TWO_MERGES = 'a: &a {x: 1}\nb: &b {y: 1}\nc:\n  <<: *a\n  <<: *b\n'

describe('merge: false', () => {
  it('keeps `<<` as an ordinary key and merges nothing', () => {
    const doc = parseDocument(MERGE_SOURCE, { merge: false })
    expect(doc.toJS()).toEqual({ base: { x: 1 }, use: { '<<': { x: 1 }, y: 2 } })
    expect(doc.errors).toEqual([])
  })

  it('merges the same document when left on', () => {
    const doc = parseDocument(MERGE_SOURCE)
    expect(doc.toJS()).toEqual({ base: { x: 1 }, use: { x: 1, y: 2 } })
    expect(doc.errors).toEqual([])
  })

  it('reports a repeated `<<` as a duplicate, which it is not while merging', () => {
    expect(parseDocument(TWO_MERGES).errors).toEqual([])

    const doc = parseDocument(TWO_MERGES, { merge: false })
    expect(doc.errors.map((e) => e.code)).toEqual(['DUPLICATE_KEY'])
    // The span is the second `<<`, the key that repeats.
    const second = TWO_MERGES.lastIndexOf('<<')
    expect(doc.errors[0]).toMatchObject({ start: second, end: second + 2 })
    // Last value wins, as for any other duplicated key.
    expect(doc.toJS()).toEqual({ a: { x: 1 }, b: { y: 1 }, c: { '<<': { y: 1 } } })
  })

  it('does not check a `<<` value it is not merging', () => {
    const doc = parseDocument('a:\n  <<: 5\n', { merge: false })
    expect(doc.errors).toEqual([])
    expect(doc.toJS()).toEqual({ a: { '<<': 5 } })
  })
})

describe('nodeAtPath and merge keys', () => {
  const doc = parseDocument(MERGE_SOURCE)
  const useMap = MERGE_SOURCE.indexOf('<<')

  it('does not find a merged key, which is not written at that path', () => {
    expect(doc.toJS()).toMatchObject({ use: { x: 1 } })
    expect(nodeAtPath(doc.contents, ['use', 'x'])).toBeUndefined()
  })

  it('falls back to the mapping holding the `<<` under `closest`', () => {
    expect(nodeAtPath(doc.contents, ['use', 'x'], true)).toMatchObject({ kind: 'map', start: useMap })
  })

  it('still addresses the `<<` pair by its written key', () => {
    // `toJS()` has no `<<` key while merging, but the path walks the written
    // tree: the segment finds the pair, ends on its alias, and a further
    // segment follows the alias into the merged mapping.
    expect(nodeAtPath(doc.contents, ['use', '<<'])).toMatchObject({ kind: 'alias', source: 'b', start: useMap + 4 })
    expect(nodeAtPath(doc.contents, ['use', '<<', 'x'])).toMatchObject({
      kind: 'scalar',
      value: 1,
      start: MERGE_SOURCE.indexOf('1'),
    })
  })
})

describe('nodeAtPath number segments', () => {
  it('matches a number segment against an integer map key', () => {
    const doc = parseDocument('200: x\n')
    expect(doc.toJS()).toEqual({ 200: 'x' })
    expect(nodeAtPath(doc.contents, [200])).toMatchObject({ kind: 'scalar', value: 'x', start: 5, end: 6 })
    expect(nodeAtPath(doc.contents, ['200'])).toMatchObject({ kind: 'scalar', value: 'x' })
  })

  it('matches one below a mapping, as a response code path is written', () => {
    const doc = parseDocument('responses:\n  200:\n    description: ok\n')
    expect(nodeAtPath(doc.contents, ['responses', 200, 'description'])).toMatchObject({ kind: 'scalar', value: 'ok' })
  })
})

describe('lineCounter offsets outside the source', () => {
  const lc = lineCounter('ab\ncd')

  it('clamps NaN to the start instead of returning col NaN', () => {
    expect(lc.linePos(Number.NaN)).toEqual({ line: 1, col: 1 })
  })

  it('clamps infinities to the ends', () => {
    expect(lc.linePos(Number.NEGATIVE_INFINITY)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(Number.POSITIVE_INFINITY)).toEqual({ line: 2, col: 3 })
  })
})

describe('keepComments across a stream', () => {
  const source = [
    '# head one',
    'a: 1 # inline one',
    '--- # marker two',
    '# head two',
    'b: 2',
    '# foot two',
    '...',
    '# head three',
    '---',
    'c: 3 # inline three',
    '# foot three',
    '',
  ].join('\n')
  const docs = parseAllDocuments(source, { keepComments: true })

  it('gives each document the comments written in its span', () => {
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
    expect(docs.map((d) => d.comments.map((c) => c.text))).toEqual([
      [' head one', ' inline one'],
      // The comment on the `---` line opens the document the marker starts.
      [' marker two', ' head two', ' foot two'],
      // A comment between `...` and the next `---` belongs to the next document.
      [' head three', ' inline three', ' foot three'],
    ])
    for (const doc of docs) expect(doc.errors).toEqual([])
  })

  it('records spans that slice each comment back out of the source', () => {
    for (const comment of docs.flatMap((d) => d.comments)) {
      expect(source.slice(comment.start, comment.end)).toBe(`#${comment.text}`)
    }
  })

  it('collects none without the option', () => {
    expect(parseAllDocuments(source).flatMap((d) => d.comments)).toEqual([])
  })
})
