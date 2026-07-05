import { describe, expect, it } from 'vitest'

import { parse } from './parse'

describe('parse', () => {
  it('parses a mapping to a plain object', () => {
    expect(parse('a: 1\nb: two\n')).toEqual({ a: 1, b: 'two' })
  })

  it('parses a sequence to an array', () => {
    expect(parse('- 1\n- 2\n- 3\n')).toEqual([1, 2, 3])
  })

  it('parses a realistic nested document', () => {
    const data = parse(['openapi: 3.1.0', 'info:', '  title: My API', '  version: 1.0.0', 'paths: {}'].join('\n'))
    expect(data).toEqual({ openapi: '3.1.0', info: { title: 'My API', version: '1.0.0' }, paths: {} })
  })

  it('returns null for an empty document', () => {
    expect(parse('')).toBeNull()
    expect(parse('\n\n# just a comment\n')).toBeNull()
  })

  it('recognizes a CRLF document-start marker on the single-doc path', () => {
    // `---` followed by CR (CRLF input) must be treated as a document marker, not
    // folded into the body as a plain scalar (`"--- a: 1"`).
    expect(parse('---\r\na: 1\r\n')).toEqual({ a: 1 })
  })

  it('coerces scalar types via the core schema', () => {
    expect(parse('n: 5\nf: 1.5\nb: true\nz: null\ns: hello\n')).toEqual({
      n: 5,
      f: 1.5,
      b: true,
      z: null,
      s: 'hello',
    })
  })
})
