import { describe, expect, it } from 'vitest'

import { isAlias, isMap, isPair, isScalar, isSeq } from './guards'
import { parseDocument } from './parse-document'

describe('guards', () => {
  it('identifies a scalar', () => {
    const node = parseDocument('hello').contents
    expect(isScalar(node)).toBe(true)
    expect(isMap(node)).toBe(false)
    expect(isSeq(node)).toBe(false)
  })

  it('identifies a map and its pairs', () => {
    const node = parseDocument('a: 1').contents
    expect(isMap(node)).toBe(true)
    if (isMap(node)) {
      expect(isPair(node.items[0])).toBe(true)
      expect(isScalar(node.items[0]?.key)).toBe(true)
    }
  })

  it('identifies a sequence', () => {
    const node = parseDocument('- 1\n- 2').contents
    expect(isSeq(node)).toBe(true)
  })

  it('identifies an alias', () => {
    const doc = parseDocument('a: &x 1\nb: *x')
    const node = doc.contents
    if (isMap(node)) expect(isAlias(node.items[1]?.value)).toBe(true)
  })

  it('rejects non-nodes', () => {
    expect(isScalar(null)).toBe(false)
    expect(isMap(undefined)).toBe(false)
    expect(isSeq('a string')).toBe(false)
    expect(isPair(42)).toBe(false)
  })
})
