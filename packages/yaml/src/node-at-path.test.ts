import { describe, expect, it } from 'vitest'

import { lineCounter } from './line-counter'
import { nodeAtPath } from './node-at-path'
import { parseDocument } from './parse-document'

describe('node-at-path', () => {
  const source = ['openapi: 3.1.0', 'info:', '  title: My API', '  version: 1.0.0', 'paths: {}'].join('\n')
  const { contents } = parseDocument(source)

  it('locates a nested scalar by path', () => {
    const node = nodeAtPath(contents, ['info', 'title'])
    expect(node?.kind).toBe('scalar')
    if (node?.kind === 'scalar') expect(node.value).toBe('My API')
  })

  it('exposes the exact source range for a located node', () => {
    const node = nodeAtPath(contents, ['info', 'title'])
    const lc = lineCounter(source)
    expect(node && lc.linePos(node.start)).toEqual({ line: 3, col: 10 })
    expect(node && lc.linePos(node.end)).toEqual({ line: 3, col: 16 })
  })

  it('locates an array element with a numeric segment', () => {
    const doc = parseDocument('tags:\n  - name: a\n  - name: b\n')
    const node = nodeAtPath(doc.contents, ['tags', 1, 'name'])
    if (node?.kind === 'scalar') expect(node.value).toBe('b')
  })

  it('returns undefined for a missing path', () => {
    expect(nodeAtPath(contents, ['info', 'description'])).toBeUndefined()
  })

  it('falls back to the closest ancestor when asked', () => {
    const node = nodeAtPath(contents, ['info', 'description'], true)
    // The `info` map begins at its first child key, `title`.
    const lc = lineCounter(source)
    expect(node && lc.linePos(node.start)).toEqual({ line: 3, col: 3 })
  })

  it('matches numeric map keys against stringified segments', () => {
    const doc = parseDocument('responses:\n  "200":\n    description: ok\n')
    const node = nodeAtPath(doc.contents, ['responses', '200', 'description'])
    if (node?.kind === 'scalar') expect(node.value).toBe('ok')
  })

  /**
   * The keys a path is written in have to be the keys `toJS()` produced —
   * otherwise a caller who walked the projected data cannot locate the node it
   * came from. These three kinds used to be addressed by a *different* string
   * than the projection used, so every lookup missed and a `closest: true`
   * lookup silently reported the parent's span instead: a diagnostic pointing at
   * the wrong line, which defeats the point of the package.
   */
  it('finds a null key under the empty string toJS projects it to', () => {
    for (const source of ['null: v\n', '~: v\n']) {
      const doc = parseDocument(source)
      expect(Object.keys(doc.toJS() as object)).toEqual([''])
      const node = nodeAtPath(doc.contents, [''])
      expect(node?.kind === 'scalar' && node.value).toBe('v')
    }
  })

  it('finds an alias key under the anchored value it resolves to', () => {
    const doc = parseDocument('k: &a name\n*a : value\n')
    expect(Object.keys(doc.toJS() as object)).toEqual(['k', 'name'])
    const node = nodeAtPath(doc.contents, ['name'])
    expect(node?.kind === 'scalar' && node.value).toBe('value')
  })

  it('finds a collection key under its flow rendering', () => {
    const doc = parseDocument('[a, b]: v\n')
    expect(Object.keys(doc.toJS() as object)).toEqual(['[ a, b ]'])
    const node = nodeAtPath(doc.contents, ['[ a, b ]'])
    expect(node?.kind === 'scalar' && node.value).toBe('v')
  })

  it('does not fall back to the parent for a key it can now address', () => {
    const doc = parseDocument('[a, b]:\n  inner: 1\n')
    const node = nodeAtPath(doc.contents, ['[ a, b ]', 'inner'], true)
    expect(node?.kind === 'scalar' && node.value).toBe(1)
  })
})
