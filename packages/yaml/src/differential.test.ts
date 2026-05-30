import { describe, expect, it } from 'vitest'
import { parse as eemeli } from 'yaml'

import { FIXTURES } from '../bench/fixtures'
import { parse as ours } from './parse'

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
})
