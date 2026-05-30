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
    expect(node && lc.linePos(node.range[0])).toEqual({ line: 3, col: 10 })
    expect(node && lc.linePos(node.range[1])).toEqual({ line: 3, col: 16 })
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
    expect(node && lc.linePos(node.range[0])).toEqual({ line: 3, col: 3 })
  })

  it('matches numeric map keys against stringified segments', () => {
    const doc = parseDocument('responses:\n  "200":\n    description: ok\n')
    const node = nodeAtPath(doc.contents, ['responses', '200', 'description'])
    if (node?.kind === 'scalar') expect(node.value).toBe('ok')
  })
})
