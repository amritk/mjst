import { describe, expect, it } from 'vitest'
import { parse as eemeli } from 'yaml'

import { loadOpenApiFixtures } from '../../../fixtures/openapi/load-fixtures'
import { FIXTURES } from '../bench/fixtures'
import { parse as ours } from './parse'

/**
 * Real-world public OpenAPI specs vendored under the repo-root
 * `fixtures/openapi/` directory (see its `README.md` for provenance). Read from
 * disk so the bytes stay identical to what the upstream publisher serves.
 * `bench/fixtures.ts` stays synthetic; this is where we exercise the parser
 * against documents we don't control. JSON fixtures are skipped — JSON is a
 * YAML subset but `JSON.parse` is the right reference for those.
 */
const VENDORED = loadOpenApiFixtures().filter((fixture) => fixture.format === 'yaml')

/**
 * Differential tests against `yaml` (eemeli) — the reference parser the Loupe
 * linter currently uses and the one that, like us, tracks source positions. For
 * the YAML subset that real configuration and OpenAPI documents use, our plain
 * data projection must match it exactly. Where we intentionally diverge from
 * `js-yaml` (its `!!timestamp` type turns ISO strings into `Date`s, which is
 * wrong for a JSON superset) we instead agree with `yaml`.
 */

const CASES: string[] = [
  // Scalars and core-schema typing.
  'n: 42\nf: 3.14\nneg: -5\nhex: 0x1F\nb1: true\nb2: false\nnil: null\ntilde: ~\n',
  'version: 1.0.0\nopenapi: 3.1.0\nname: hello world\n',
  'empty:\nafter: 1\n',
  // Sequences in both styles.
  '- a\n- b\n- c\n',
  'items:\n- 1\n- 2\n',
  'matrix:\n  - [1, 2]\n  - [3, 4]\n',
  // Mappings nested in sequences and vice versa.
  '- name: a\n  tags: [x, y]\n- name: b\n  tags: []\n',
  // Flow collections.
  'a: [1, 2, 3]\nb: {x: 1, y: 2}\nc: []\nd: {}\n',
  'nested: {list: [1, {deep: true}], n: null}\n',
  // Quoting and escapes.
  `s: 'single ''quote'''\nd: "double \\"quote\\" and \\n newline"\n`,
  'q: "https://example.com/a?b=c&d=e"\n',
  // Multi-line flow scalars — folding edge cases that real specs (GitHub's
  // OpenAPI) hit: trailing whitespace on the closing line is literal content,
  // and a blank-line run reaching the close yields one fewer newline.
  "s: 'first line\n  second line. '\n",
  's: "first line\n  second line. "\n',
  "s: 'para one\n  still one\n\n  '\n",
  's: "para one\n  still one\n\n  "\n',
  "s: 'a\n\n\n  '\nt: 'a\n  b\n\n  c'\n",
  // Block scalars with chomping.
  'text: |\n  line one\n  line two\n',
  'text: |-\n  no trailing\n',
  'folded: >\n  one\n  two\n  three\n',
  // Comments scattered through the document.
  '# leading\na: 1 # inline\n# middle\nb: 2\n',
  // Anchors, aliases, and merge keys.
  'a: &x\n  k: 1\nb: *x\n',
  'base: &b {p: 1, q: 2}\nuse:\n  <<: *b\n  q: 3\n',
  // Realistic documents.
  FIXTURES.small,
  FIXTURES.medium,
  FIXTURES.large,
]

describe('differential', () => {
  for (const [index, source] of CASES.entries()) {
    const label = source.length > 40 ? `${source.slice(0, 37).replace(/\n/g, '\\n')}…` : source.replace(/\n/g, '\\n')
    it(`matches yaml for case ${index}: ${label}`, () => {
      // `yaml` defaults merge keys off; we default them on, so enable them here
      // to line the two up on the `<<` case.
      expect(ours(source)).toEqual(eemeli(source, { merge: true }))
    })
  }

  // Large, real-world public specs we don't control — the documents this
  // parser actually has to survive in the wild.
  for (const { name, source } of VENDORED) {
    it(`matches yaml for vendored spec: ${name}`, () => {
      expect(ours(source)).toEqual(eemeli(source, { merge: true }))
    })
  }
})
