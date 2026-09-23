import { describe, expect, it } from 'vitest'

import { parseYamlStrict } from './parse-yaml-strict'

const WHAT = 'a test document'

describe('parse-yaml-strict', () => {
  it('returns the value of a well-formed document', () => {
    expect(parseYamlStrict('a: 1\nb: [x, y]\n', '/specs/ok.yaml', { what: WHAT })).toEqual({ a: 1, b: ['x', 'y'] })
  })

  it('returns null for an empty document', () => {
    expect(parseYamlStrict('', '/specs/empty.yaml', { what: WHAT })).toBeNull()
  })

  // The salvage of `b: [1, 2` swallows the next line into a bogus `"2 c"` key;
  // handing that on as data is the silent corruption this guards against.
  it('throws on a parse error, naming the file and the line:col of the problem', () => {
    expect(() => parseYamlStrict('a: 1\nb: [1, 2\nc: 3\n', '/specs/broken.yaml', { what: WHAT })).toThrow(
      'Failed to parse /specs/broken.yaml as YAML:\n  - /specs/broken.yaml:2:4: Missing closing "]" for flow sequence',
    )
  })

  it('joins problems on one line when asked, for one-line-per-finding reports', () => {
    expect(() =>
      parseYamlStrict('a: 1\nb: [1, 2\nc: 3\n', '/specs/broken.yaml', { what: WHAT, singleLine: true }),
    ).toThrow(
      'Failed to parse /specs/broken.yaml as YAML: /specs/broken.yaml:2:4: Missing closing "]" for flow sequence',
    )
  })

  it('lists at most five problems and counts the rest', () => {
    // Seven `a:` keys: six duplicates, one per line from line 2.
    const text = 'a: 1\n'.repeat(7)
    let message = ''
    try {
      parseYamlStrict(text, '/x.yaml', { what: WHAT })
    } catch (error) {
      message = (error as Error).message
    }
    const lines = message.split('\n')
    expect(lines[0]).toBe('Failed to parse /x.yaml as YAML:')
    expect(lines.slice(1, 6).map((line) => line.slice(0, line.indexOf(': ')))).toEqual([
      '  - /x.yaml:2:1',
      '  - /x.yaml:3:1',
      '  - /x.yaml:4:1',
      '  - /x.yaml:5:1',
      '  - /x.yaml:6:1',
    ])
    expect(lines.slice(6)).toEqual(['  - …and 1 more'])
  })

  // Only the first document of a `---` stream is parsed; reading half a file
  // while reporting success would silently drop everything after the marker.
  it('throws on a multi-document stream, pointing at where the second document starts', () => {
    expect(() => parseYamlStrict('a: 1\n---\nb: 2\n', '/specs/multi.yaml', { what: WHAT })).toThrow(
      '/specs/multi.yaml contains multiple YAML documents (the second starts at /specs/multi.yaml:2:1); a test document must be a single-document file.',
    )
  })

  it('reports CRLF positions by line, not by raw offset', () => {
    expect(() => parseYamlStrict('a: 1\r\nb: 2\r\nc: [1\r\n', '/w.yaml', { what: WHAT })).toThrow('/w.yaml:3:4: ')
  })

  it('passes parse options through', () => {
    // With duplicate detection off the last value wins, as with `JSON.parse`.
    expect(parseYamlStrict('a: 1\na: 2\n', '/d.yaml', { what: WHAT, uniqueKeys: false })).toEqual({ a: 2 })
    expect(() => parseYamlStrict('a: 1\na: 2\n', '/d.yaml', { what: WHAT })).toThrow(/\/d\.yaml:2:1: /)
  })
})
