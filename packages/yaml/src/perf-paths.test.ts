import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { isAlias, isMap, isSeq } from './guards'
import { type NodePath, nodeAtPath } from './node-at-path'
import { keyText, parseDocument } from './parse-document'
import type { YamlMap, YamlNode, YamlPair, YamlScalar } from './types'

/**
 * The obvious linear walk `nodeAtPath` did before maps gained a key index: the
 * reference its answers must match node-for-node, whichever of its two lookups
 * (linear scan or index) a map takes.
 */
const naiveNodeAtPath = (root: YamlNode | null, path: NodePath, closest = false): YamlNode | undefined => {
  if (root === null) return undefined
  let node: YamlNode = root
  let matched: YamlNode = root
  for (const segment of path) {
    if (isAlias(node)) {
      let target: YamlNode | undefined = node
      for (let hops = 0; target !== undefined && isAlias(target); hops++) {
        target = hops >= 100 ? undefined : target.target
      }
      if (target === undefined) return closest ? matched : undefined
      node = target
    }
    let next: YamlNode | null | undefined
    if (isMap(node)) {
      const key = String(segment)
      for (let i = node.items.length - 1; i >= 0; i--) {
        const pair = node.items[i]
        if (pair !== undefined && keyText(pair.key) === key) {
          next = pair.value
          break
        }
      }
    } else if (isSeq(node)) {
      const index = typeof segment === 'number' ? segment : Number(segment)
      next = Number.isInteger(index) ? node.items[index] : undefined
    }
    if (next == null) return closest ? matched : undefined
    node = next
    matched = next
  }
  return node
}

/** Every path into a `toJS()` projection, root included, in walk order. */
const allPaths = (value: unknown, path: (string | number)[] = [], out: (string | number)[][] = []) => {
  out.push(path)
  if (Array.isArray(value)) value.forEach((item, i) => void allPaths(item, [...path, i], out))
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) allPaths(item, [...path, key], out)
  }
  return out
}

/**
 * Resolves every path of the projection — plus a missing child under each, with
 * and without `closest` — through both walkers and returns the first path where
 * they disagree, so a failure names it rather than printing two huge trees.
 */
const firstMismatch = (contents: YamlNode | null, data: unknown): NodePath | undefined => {
  for (const path of allPaths(data)) {
    if (nodeAtPath(contents, path) !== naiveNodeAtPath(contents, path)) return path
    const missing = [...path, '\u0000missing']
    if (nodeAtPath(contents, missing, true) !== naiveNodeAtPath(contents, missing, true)) return missing
    if (nodeAtPath(contents, missing) !== undefined) return missing
  }
  return undefined
}

/**
 * A mapping far past the index threshold, keyed the ways that make `keyText`
 * matter: numbers, booleans, `~` (keyed `''`), quoted strings that look like
 * numbers, a flow collection as a key, and nested wide maps and sequences.
 * `~` and `""` both key `''`, a deliberate duplicate — parse it with
 * `uniqueKeys: false`.
 */
const wideDocument = (width: number): string => {
  const lines: string[] = ['root: &wide']
  for (let i = 0; i < width; i++) {
    if (i % 7 === 0) lines.push(`  ${i}: int-${i}`)
    else if (i % 7 === 1) lines.push(`  "q${i}": quoted-${i}`)
    else if (i % 7 === 2) {
      lines.push(`  nested${i}:`)
      for (let j = 0; j < 20; j++) lines.push(`    k${j}: [${i}, ${j}]`)
    } else lines.push(`  key${i}: value-${i}`)
  }
  lines.push('  true: yes-bool', '  ~: null-key', '  "": empty-key', '  [a, b]: flow-key', '  0x10: hex', '  "1": one')
  lines.push('alias: *wide', 'list:', '  - *wide', '  - plain')
  return `${lines.join('\n')}\n`
}

describe('perf-paths: nodeAtPath key index', () => {
  it('matches the naive walker on every path of a wide generated map', () => {
    const doc = parseDocument(wideDocument(300), { uniqueKeys: false })
    expect(doc.errors).toEqual([])
    const root = nodeAtPath(doc.contents, ['root'])
    expect(root?.kind === 'map' && root.items.length).toBeGreaterThan(300)
    expect(firstMismatch(doc.contents, doc.toJS())).toBeUndefined()
  })

  it('resolves stringified keys the way the projection wrote them', () => {
    const doc = parseDocument(wideDocument(40), { uniqueKeys: false })
    const valueAt = (path: NodePath) => (nodeAtPath(doc.contents, path) as YamlScalar | undefined)?.value
    expect(valueAt(['root', 7])).toBe('int-7')
    expect(valueAt(['root', '7'])).toBe('int-7')
    expect(valueAt(['root', 'true'])).toBe('yes-bool')
    // `~` and `""` both key the empty string; the later pair is the one that won.
    expect(valueAt(['root', ''])).toBe('empty-key')
    expect(valueAt(['root', '[ a, b ]'])).toBe('flow-key')
    expect(valueAt(['root', 16])).toBe('hex')
    expect(valueAt(['root', 1])).toBe('one')
    expect(valueAt(['alias', 'key3'])).toBe('value-3')
    expect(valueAt(['list', 0, 'nested2', 'k5', 1])).toBe(5)
  })

  it('resolves a duplicated key in a wide map to the pair that won', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `k${i % 20}: v${i}`)
    const doc = parseDocument(lines.join('\n'), { uniqueKeys: false })
    expect(doc.toJS()).toMatchObject({ k0: 'v20', k19: 'v39' })
    expect((nodeAtPath(doc.contents, ['k0']) as YamlScalar).value).toBe('v20')
    expect((nodeAtPath(doc.contents, ['k19']) as YamlScalar).value).toBe('v39')
    expect(firstMismatch(doc.contents, doc.toJS())).toBeUndefined()
  })

  it('keeps `closest` pointing at the wide map when its key is missing or has no value', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `k${i}: v${i}`)
    const doc = parseDocument(`m:\n${lines.map((l) => `  ${l}`).join('\n')}\n  empty:\n`)
    const map = nodeAtPath(doc.contents, ['m'])
    expect(map?.kind).toBe('map')
    expect(nodeAtPath(doc.contents, ['m', 'nope'])).toBeUndefined()
    expect(nodeAtPath(doc.contents, ['m', 'nope', 'deeper'], true)).toBe(map)
    expect(nodeAtPath(doc.contents, ['m', 'empty'], true)).toBe(map)
    expect(nodeAtPath(doc.contents, ['m', 'empty'])).toBeUndefined()
  })

  it('sees pairs pushed onto or removed from a map after it was indexed', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `k${i}: v${i}`)
    const doc = parseDocument(lines.join('\n'))
    const map = doc.contents as YamlMap
    // First lookup builds the index.
    expect((nodeAtPath(map, ['k3']) as YamlScalar).value).toBe('v3')
    expect(nodeAtPath(map, ['added'])).toBeUndefined()

    const scalar = (value: string): YamlScalar => ({
      kind: 'scalar',
      value,
      source: value,
      style: 'plain',
      start: 0,
      end: 0,
    })
    const pair = (key: string, value: string): YamlPair => ({
      kind: 'pair',
      key: scalar(key),
      value: scalar(value),
      start: 0,
      end: 0,
    })
    map.items.push(pair('added', 'new'))
    expect((nodeAtPath(map, ['added']) as YamlScalar).value).toBe('new')
    // A pushed duplicate is the pair that now wins, as it would in `toJS()`.
    map.items.push(pair('k3', 'shadowed'))
    expect((nodeAtPath(map, ['k3']) as YamlScalar).value).toBe('shadowed')
    map.items.pop()
    expect((nodeAtPath(map, ['k3']) as YamlScalar).value).toBe('v3')
    map.items.splice(0, 5)
    expect(nodeAtPath(map, ['k3'])).toBeUndefined()
    expect(firstMismatch(map, doc.toJS())).toBeUndefined()
  })

  it('matches the naive walker on every path of the OpenAI OpenAPI document', () => {
    const file = fileURLToPath(new URL('../../../fixtures/openapi/real-world/openai.yaml', import.meta.url))
    const doc = parseDocument(readFileSync(file, 'utf8'))
    expect(firstMismatch(doc.contents, doc.toJS())).toBeUndefined()
  })
})

describe('perf-paths: block scalar line ends', () => {
  const EOLS = [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ] as const

  /**
   * Each case is written with `\n` and re-joined with every line ending. `body`
   * is the exact source text the scalar node covers (from its `|`/`>` to the end
   * of its last content line), which pins `start`, `end` and `source` at once.
   */
  const CASES: { name: string; before: string; body: string; after: string; value: string }[] = [
    { name: 'literal', before: 'a: ', body: '|\n  one\n  two', after: '\nb: 1\n', value: 'one\ntwo\n' },
    {
      name: 'literal with interior and trailing blanks',
      before: 'a: ',
      body: '|+\n  one\n\n    two  \n  three',
      after: '\n\n\nb: 1\n',
      value: 'one\n\n  two  \nthree\n\n\n',
    },
    {
      name: 'folded strip',
      before: 'a: ',
      body: '>-\n  one\n  two\n\n  three',
      after: '\nb: 1\n',
      value: 'one two\nthree',
    },
    { name: 'no final newline', before: 'a: ', body: '|\n  one\n  two', after: '', value: 'one\ntwo\n' },
    { name: 'no final newline, strip', before: 'k:\n  a: ', body: '|-\n    x\n    y', after: '', value: 'x\ny' },
    { name: 'root literal', before: '--- ', body: '|\n one\n two', after: '\n...\n', value: 'one\ntwo\n' },
    { name: 'explicit indent', before: 'a: ', body: '|2\n    lead\n  base', after: '\n', value: '  lead\nbase\n' },
    { name: 'single char content line at end', before: 'a: ', body: '|\n  x', after: '', value: 'x\n' },
  ]

  for (const { name, before, body, after, value } of CASES) {
    for (const [eol, nl] of EOLS) {
      it(`${name} (${eol})`, () => {
        const join = (text: string) => text.replaceAll('\n', nl)
        const src = join(before + body + after)
        const doc = parseDocument(src)
        expect(doc.errors).toEqual([])
        let node: YamlNode | null | undefined = doc.contents
        if (node?.kind === 'map') node = nodeAtPath(node, before.startsWith('k:') ? ['k', 'a'] : ['a'])
        expect(node?.kind).toBe('scalar')
        const scalar = node as YamlScalar
        expect(scalar.value).toBe(value)
        expect(scalar.start).toBe(join(before).length)
        expect(scalar.end).toBe(join(before + body).length)
        expect(scalar.source).toBe(join(body))
      })
    }
  }

  it('reads a block scalar the same when a CR appears only elsewhere in the document', () => {
    const src = 'a: |\n  one\n  two\nb: "x\r\n  y"\n'
    const doc = parseDocument(src)
    const node = nodeAtPath(doc.contents, ['a']) as YamlScalar
    expect(node.value).toBe('one\ntwo\n')
    expect(node.end).toBe(src.indexOf('two') + 3)
  })
})

describe('perf-paths: plain scalar line scan', () => {
  // A block plain scalar's line end and its `: ` check are found in one pass,
  // with a single comparison for any character above `:`. These pin the
  // characters on either side of that boundary, and every way a line can end.
  const problems = (src: string) => parseDocument(src).errors.map((e) => [e.code, e.start, e.end])

  it('reports a `: ` at its own offset, whatever follows the colon', () => {
    for (const src of [
      'a: b: c\n',
      'a: b:\tc\n',
      'a: b:\n',
      'a: b:',
      'a: b:\r\nc: d\r\n',
      'a: b:\rc: d\r',
      'a: b:  # note\n',
    ]) {
      expect(problems(src)).toEqual([['BAD_SCALAR_CONTENT', 4, 5]])
    }
    expect(problems('a: x y: z\n')).toEqual([['BAD_SCALAR_CONTENT', 6, 7]])
  })

  it('leaves a colon glued to the next character, or inside a trailing comment, alone', () => {
    expect(parseDocument('a: b:#c\n').toJS()).toEqual({ a: 'b:#c' })
    expect(parseDocument('a: b # c: d\n').toJS()).toEqual({ a: 'b' })
    expect(parseDocument('a: 1:2:3\n').toJS()).toEqual({ a: '1:2:3' })
    for (const src of ['a: b:#c\n', 'a: b # c: d\n', 'a: 1:2:3\n']) expect(problems(src)).toEqual([])
  })

  it('ends the scalar before trailing white space and a comment', () => {
    const src = 'a: value \t # c\nb: 1\n'
    const doc = parseDocument(src)
    const node = nodeAtPath(doc.contents, ['a']) as YamlScalar
    expect(node.source).toBe('value')
    expect(node.end).toBe(src.indexOf(' \t'))
    expect(doc.toJS()).toEqual({ a: 'value', b: 1 })
  })
})

describe('perf-paths: flow plain scalar line scan', () => {
  // A lookup table decides which characters stop a flow plain scalar; only a
  // `:` and a `#` then need a second look at their neighbours.
  it('stops at flow indicators and separating colons, and keeps every other character', () => {
    expect(parseDocument('{ url: http://x:80/y, n: a#b }').toJS()).toEqual({ url: 'http://x:80/y', n: 'a#b' })
    expect(parseDocument('{a:{b: 1}}').toJS()).toEqual({ a: { b: 1 } })
    expect(parseDocument('{a:1}').toJS()).toEqual({ 'a:1': null })
    expect(parseDocument('[a:[b]]').toJS()).toEqual([{ a: ['b'] }])
    expect(parseDocument('[a, b #c\n, d]').toJS()).toEqual(['a', 'b', 'd'])
    expect(parseDocument('[ é, ü:v ]').toJS()).toEqual(['é', 'ü:v'])
  })
})

describe('perf-paths: repeated line peeks', () => {
  // The line after a plain scalar, and the line that closes a nested block, are
  // measured once and the answer reused by every caller that asks again.
  it('hands the line that closes several levels to each of them', () => {
    const src = 'a:\n  b:\n    c:\n      d: 1\ne: 2\n'
    const doc = parseDocument(src)
    expect(doc.toJS()).toEqual({ a: { b: { c: { d: 1 } } }, e: 2 })
    expect(nodeAtPath(doc.contents, ['e'])?.start).toBe(src.indexOf('2'))
    expect(parseDocument('a:\n  - x\n  - y\nb: z\n').toJS()).toEqual({ a: ['x', 'y'], b: 'z' })
    expect(parseDocument('k: a\n  b\nn: 1\n').toJS()).toEqual({ k: 'a b', n: 1 })
  })

  it('still measures a tab-indented line against the caller asking', () => {
    // A tab inside the indentation the line owes is an error; past it, it is
    // separation. Which one depends on the caller, so these lines are never reused.
    const inside = parseDocument('a:\n  b: 1\n\tc: 2\n')
    expect(inside.errors.map((e) => [e.code, e.start, e.end])).toEqual([
      ['TAB_INDENT', 10, 11],
      ['UNEXPECTED_CONTENT', 11, 15],
    ])
    const past = parseDocument('a:\n  b: x\n \tc: 2\n')
    expect(past.errors.map((e) => [e.code, e.start, e.end])).toEqual([['TAB_INDENT', 11, 12]])
    expect(past.toJS()).toEqual({ a: { b: 'x', c: 2 } })
  })

  it('records each comment once when nested blocks close around it', () => {
    const doc = parseDocument('a:\n  b: 1 # one\n# own line\n  c: 2\nd: 3 # three\n', { keepComments: true })
    expect(doc.comments.map((c) => [c.text, c.start])).toEqual([
      [' one', 10],
      [' own line', 16],
      [' three', 39],
    ])
    const closing = parseDocument('a:\n  b:\n    c: x\n  # between\nd: y\n', { keepComments: true })
    expect(closing.comments.map((c) => [c.text, c.start])).toEqual([[' between', 19]])
    expect(closing.toJS()).toEqual({ a: { b: { c: 'x' } }, d: 'y' })
  })
})
