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

  // YAML 1.2 §5.4 makes CR LF, a lone CR, and a lone LF all one line break, so
  // positions have to advance the line for each of the three — otherwise a
  // diagnostic in a CR-delimited document points at a line that is not there.
  it('advances the line on a lone CR', () => {
    const lc = lineCounter('a: 1\rb: 2\rc: 3\r')
    expect(lc.linePos(0)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(5)).toEqual({ line: 2, col: 1 })
    expect(lc.linePos(10)).toEqual({ line: 3, col: 1 })
  })

  it('counts CR LF as a single break', () => {
    const lc = lineCounter('a: 1\r\nb: 2\r\n')
    expect(lc.linePos(6)).toEqual({ line: 2, col: 1 })
    expect(lc.linePos(12)).toEqual({ line: 3, col: 1 })
  })

  it('handles a document mixing all three break styles', () => {
    // Lines: `a: 1` (CR), `b: 2` (CR LF), `c: 3` (LF).
    const lc = lineCounter('a: 1\rb: 2\r\nc: 3\n')
    expect(lc.linePos(5)).toEqual({ line: 2, col: 1 })
    expect(lc.linePos(11)).toEqual({ line: 3, col: 1 })
    expect(lc.linePos(16)).toEqual({ line: 4, col: 1 })
  })
})
