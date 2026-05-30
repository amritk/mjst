import { describe, expect, it } from 'vitest'

import { lineCounter } from './line-counter'

describe('line-counter', () => {
  const source = 'openapi: 3.1.0\ninfo:\n  title: My API\n'

  it('maps the first offset to line 1, column 1', () => {
    expect(lineCounter(source).linePos(0)).toEqual({ line: 1, col: 1 })
  })

  it('maps an offset on a later line', () => {
    // Offset 30 is the `M` of "My API" on the third line.
    expect(lineCounter(source).linePos(30)).toEqual({ line: 3, col: 10 })
  })

  it('places a position right after a newline at the next line start', () => {
    // Offset 15 is the first character of the second line (`info:`).
    expect(lineCounter(source).linePos(15)).toEqual({ line: 2, col: 1 })
  })

  it('clamps out-of-range offsets', () => {
    const lc = lineCounter('abc')
    expect(lc.linePos(-5)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(999)).toEqual({ line: 1, col: 4 })
  })

  it('handles an empty source', () => {
    expect(lineCounter('').linePos(0)).toEqual({ line: 1, col: 1 })
  })
})
