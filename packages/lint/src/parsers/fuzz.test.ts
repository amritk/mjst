import { describe, expect, it } from 'vitest'

import { parseJson, parseWithPointers } from './index'

// A battery of well-formed and malformed documents. The parser must never throw
// — problems are surfaced as diagnostics — and must always return a result with
// a working `getLocationForJsonPath`.
const YAML_SAMPLES: string[] = [
  '',
  '# just a comment\n',
  'a: 1\n',
  'nested:\n  deep:\n    value: true\n',
  'list:\n  - one\n  - two\n  - three\n',
  'flow: { a: 1, b: [2, 3], c: { d: 4 } }\n',
  'inline_list: [1, 2, [3, [4, [5]]]]\n',
  'literal: |\n  line one\n  line two\n',
  'folded: >\n  wrapped\n  text\n',
  'anchored: &a hello\nalias: *a\n',
  'quoted: "with \\"escapes\\" and \\n newline"\n',
  "single: 'a ''quoted'' value'\n",
  'unicode: café — 日本語 — 😀\n',
  'types:\n  n: 42\n  f: 1.5\n  b: false\n  z: null\n  v: 1.0.0\n',
  'empty_map: {}\nempty_seq: []\n',
  'deep:' + '\n  a:'.repeat(30) + ' 1\n',
  // Malformed — must be reported, not thrown:
  'unterminated: [1, 2, 3\n',
  'a: 1\na: 2\n',
  'tab:\tvalue\n',
]

const JSON_SAMPLES: string[] = [
  '{}',
  '[]',
  '{ "a": 1, "b": [2, 3], "c": { "d": true, "e": null } }',
  '[[[[[1]]]]]',
  '{ "s": "with \\"escapes\\" and \\u00e9" }',
  '{ "nums": [0, -1, 3.14, 1e10] }',
  // Malformed — must be reported, not thrown:
  '{ "a": }',
  '{ "a": 1,, }',
  '{ unquoted: 1 }',
]

describe('parser robustness (never throws)', () => {
  for (const [i, sample] of YAML_SAMPLES.entries()) {
    it(`parses YAML sample #${i} without throwing`, () => {
      let result: ReturnType<typeof parseWithPointers> | undefined
      expect(() => {
        result = parseWithPointers(sample)
      }).not.toThrow()
      expect(result).toBeDefined()
      // The location lookup is always callable and never throws on any path.
      expect(() => result?.getLocationForJsonPath(['does', 'not', 'exist'], true)).not.toThrow()
    })
  }

  for (const [i, sample] of JSON_SAMPLES.entries()) {
    it(`parses JSON sample #${i} without throwing`, () => {
      expect(() => parseJson(sample)).not.toThrow()
    })
  }
})

describe('JSON differential vs JSON.parse', () => {
  it('produces the same data as JSON.parse for well-formed JSON', () => {
    for (const sample of JSON_SAMPLES) {
      let native: unknown
      let nativeThrew = false
      try {
        native = JSON.parse(sample)
      } catch {
        nativeThrew = true
      }
      if (nativeThrew) continue // malformed sample — covered by the robustness suite
      const { data, diagnostics } = parseJson(sample)
      expect(diagnostics).toHaveLength(0)
      expect(data).toEqual(native)
    }
  })
})

describe('positions survive a deeply nested document', () => {
  it('locates a leaf 30 levels deep', () => {
    const depth = 30
    let source = 'root:\n'
    let pad = '  '
    for (let i = 0; i < depth - 1; i++) {
      source += `${pad}a:\n`
      pad += '  '
    }
    source += `${pad}a: leaf\n` // the 30th `a`, carrying the leaf value
    const { data, getLocationForJsonPath } = parseWithPointers(source)
    expect(data).toBeDefined()
    const path = ['root', ...Array(depth).fill('a')]
    const loc = getLocationForJsonPath(path)
    expect(loc?.range.start.line).toBe(depth) // line 0 is `root:`, then one `a:` per line
  })
})
