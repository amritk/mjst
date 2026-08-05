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
 * `js-yaml` (it *implicitly* turns untagged ISO date strings into `Date`s, which
 * is wrong for a JSON superset) we instead agree with `yaml` and keep them
 * strings. An *explicit* `!!timestamp` tag still resolves to a `Date`, matching
 * `yaml`.
 */

/**
 * `yaml` defaults merge keys off; we default them on, so enable them here to
 * line the two up on the `<<` cases. `logLevel: 'silent'` only quiets its
 * logger — a mapping keyed by a collection draws a `console.warn` about
 * stringifying the key, which is exactly what the collection-key cases below
 * are here to check, and a dozen of those buried the real test output.
 */
const REFERENCE_OPTIONS = { merge: true, logLevel: 'silent' } as const

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
  // Multi-line *plain* scalars inside flow collections: line folding must match
  // quoted-scalar folding — a single break is a space, a run of n breaks yields
  // n-1 newlines, and each wrapped line's leading indentation is not content.
  '[a\nb, c]\n',
  '[\n  a\n  b,\n  c\n]\n',
  '{k: a\n  b, m: 2}\n',
  '[a\n\n\n  b]\n',
  '{key\n  two: val\n  ue}\n',
  // A bare `-` at end of line is an entry with an empty (null) value, not the
  // end of the sequence — so a trailing empty item must be preserved, and a
  // block sequence written entirely as bare dashes must still parse as a list.
  '- ~\n- null\n-\n',
  'items:\n  - a\n  -\n  - b\n',
  'a:\n  -\n  -\n',
  // Explicit `!!bool` tags must coerce quoted/plain scalars to booleans, the same
  // way `!!int` / `!!str` / `!!null` already do.
  'a: !!bool "true"\nb: !!bool false\nc: !!bool "FALSE"\n',
  // A sequence entry holding nothing but a tag or an anchor is an empty node,
  // and the dash below it is the next entry — not that node's content. Reading
  // it as content nested the rest of the list inside the first entry, so the
  // sequence came back a single item long with everything buried under it.
  '- !!str\n- a\n- b\n',
  '- &x\n- a\n',
  '- a\n- !!str\n- b\n',
  '- !!seq\n  - inner\n- a\n',
  // A flow collection's own `: ` separators are not the block entry's. Scanning
  // past them split `{x: 1}` into the key `{x` and the value `1}`, on the key
  // side of an explicit entry, on its value side, and on any block-mapping entry
  // after the first.
  '? {x: 1}\n: a\n',
  '? [a: 1]\n: v\n',
  '? k\n: {x: 1}\n',
  'a: 1\n{x: 2}: v\n',
  'a: 1\n[x, y]: v\n',
  // Block scalars with chomping.
  'text: |\n  line one\n  line two\n',
  'text: |-\n  no trailing\n',
  'folded: >\n  one\n  two\n  three\n',
  // Comments scattered through the document.
  '# leading\na: 1 # inline\n# middle\nb: 2\n',
  // Anchors, aliases, and merge keys.
  'a: &x\n  k: 1\nb: *x\n',
  'base: &b {p: 1, q: 2}\nuse:\n  <<: *b\n  q: 3\n',
  // Merged keys that collide with an `Object.prototype` member. A prototype-chain
  // membership test (`k in target`) drops every one of these silently, and no
  // real-world fixture happens to name a key `toString`.
  'base: &b\n  toString: TS\n  valueOf: VO\n  constructor: C\n  hasOwnProperty: HOP\nuse:\n  <<: *b\n',
  'base: &b\n  toString: TS\nuse:\n  <<: *b\n  toString: mine\n',
  // Realistic documents.
  FIXTURES.small,
  FIXTURES.medium,
  FIXTURES.large,
]

const label = (source: string): string =>
  source.length > 40
    ? `${source.slice(0, 37).replace(/\n/g, '\\n')}…`
    : source.replace(/\n/g, '\\n').replace(/\r/g, '\\r')

describe('differential', () => {
  for (const [index, source] of CASES.entries()) {
    it(`matches yaml for case ${index}: ${label(source)}`, () => {
      expect(ours(source)).toEqual(eemeli(source, REFERENCE_OPTIONS))
    })
  }

  /**
   * Every case above re-run with its LF breaks swapped for CR LF and for a lone
   * CR. YAML 1.2 §5.4 makes all three one line break (`b-break ::= CR LF | CR |
   * LF`), so each variant must project to what `yaml` produces for the *LF*
   * original — the reference is still external, we have just moved which
   * spelling of the same document we feed ourselves. (Comparing lone CR against
   * `yaml` on the CR text itself is not an option: `yaml` does not accept a lone
   * CR as a break, and neither did we — a CR-delimited document lost every line
   * after the first, silently.)
   */
  for (const [name, brk] of [
    ['CR LF', '\r\n'],
    ['lone CR', '\r'],
  ] as const) {
    for (const [index, source] of CASES.entries()) {
      const converted = source.replace(/\n/g, brk)
      it(`matches yaml with ${name} breaks for case ${index}: ${label(source)}`, { timeout: 30_000 }, () => {
        expect(ours(converted)).toEqual(eemeli(source, REFERENCE_OPTIONS))
      })
    }
  }

  // Large, real-world public specs we don't control — the documents this
  // parser actually has to survive in the wild. Parsing a multi-thousand-line
  // spec twice (ours + the reference) and deep-equalling the trees is well
  // within the default 5s locally, but the CI runner executes the workspace
  // suites in parallel, and under that contention the biggest fixture
  // (openai.yaml) can tip past it — so give these cases the same generous
  // budget the other real-world differential suites use.
  for (const { name, source } of VENDORED) {
    it(`matches yaml for vendored spec: ${name}`, { timeout: 30_000 }, () => {
      expect(ours(source)).toEqual(eemeli(source, REFERENCE_OPTIONS))
    })
  }
})
