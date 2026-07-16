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

  it('resolves a scalar type even when a blank line follows it', () => {
    // A blank line before the next entry must not turn `1`/`true` into strings.
    expect(parse('port: 8080\n\nhost: x\n')).toEqual({ port: 8080, host: 'x' })
    expect(parse('a: 1\n\nb: true\n\nc: 1.5\n\nd: null\n')).toEqual({ a: 1, b: true, c: 1.5, d: null })
    // Multiple blank lines behave the same.
    expect(parse('k: 42\n\n\n\nj: 7\n')).toEqual({ k: 42, j: 7 })
    // A genuinely multi-line plain scalar still folds to a string.
    expect(parse('m: foo\n  bar\n\nn: 2\n')).toEqual({ m: 'foo bar', n: 2 })
  })
})
