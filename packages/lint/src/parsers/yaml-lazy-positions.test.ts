import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  keyText,
  parseAllDocuments,
  type YamlMap,
  type YamlNode,
  type YamlPair,
} from '@amritk/yaml'
import { describe, expect, it } from 'vitest'

import { lintDocument } from '../index'
import { createLineMap } from './lines'
import { DiagnosticSeverity, type IRange, type JsonPath } from './types'
import { parseYaml } from './yaml'
import { createYamlLocator, type YamlLocatorOptions } from './yaml-locator'

/**
 * The eager position index `parseYaml` built before positions went on demand,
 * kept verbatim (minus the diagnostics plumbing) as the reference the lazy
 * lookup must agree with. It walks every node up front and writes each path's
 * range into a map keyed by path text, so its quirks — last write wins, merged
 * keys only fill unclaimed paths, the whole-stream node budget — are the
 * behaviour the lazy lookup replicates. The one exception is how a merge
 * source's keys are read (see `walkMerge`), where the index disagreed with
 * `toJS` and the lookup now follows `toJS`.
 */
const eagerReference = (source: string, uniqueKeys = true) => {
  const lineMap = createLineMap(source)
  const docs = parseAllDocuments(source, { uniqueKeys })
  const index = new Map<string, { path: JsonPath; range: IRange }>()
  const nonFinite: { start: number; end: number }[] = []

  const pathKey = (path: JsonPath): string => {
    let key = ''
    for (const segment of path) {
      const text = String(segment)
      key += `${text.length}:${text}`
    }
    return key
  }
  const rangeOf = (node: YamlNode): IRange => ({
    start: lineMap.positionAt(node.start),
    end: lineMap.positionAt(node.end),
  })
  let budget = Math.max(100_000, source.length * 100)
  const isMergePair = (pair: YamlPair): boolean => isScalar(pair.key) && pair.key.source === '<<'

  /** Calls `visit` with each map a `<<` value folds in, in `applyMerge` order. */
  const forEachSource = (node: YamlNode | null | undefined, visit: (source: YamlMap) => void): void => {
    const target = node != null && isAlias(node) ? node.target : node
    if (target == null) return
    if (isSeq(target)) {
      if (target.tag !== 'omap') for (const item of target.items) forEachSource(item, visit)
    } else if (isMap(target) && target.tag !== 'set') {
      visit(target)
    }
  }

  /**
   * The key-to-node table `toJsValue` builds a map's object from: pair by pair,
   * an explicit key overwriting and a `<<` copying in the keys of its source's
   * own finished table that are not there yet. Valueless keys are left out, as
   * the index always left them out.
   */
  const projected = new Map<YamlMap, Map<string, YamlNode>>()
  const projectedPairs = (map: YamlMap): Map<string, YamlNode> => {
    const cached = projected.get(map)
    if (cached) return cached
    const out = new Map<string, YamlNode>()
    projected.set(map, out)
    for (const item of map.items) {
      if (!isPair(item)) continue
      if (isMergePair(item)) {
        forEachSource(item.value, (source) => {
          for (const [key, value] of projectedPairs(source)) if (!out.has(key)) out.set(key, value)
        })
      } else if (item.value != null) {
        out.set(keyText(item.key), item.value)
      }
    }
    return out
  }

  /**
   * The one place this departs from the index as it shipped: that walked a
   * merge source's pairs in source order, so a nested `<<` written ahead of an
   * explicit key claimed the key first, and a duplicated key in a source
   * resolved to its first occurrence. Both pointed at a value `toJS` drops, so
   * the reference now walks what the source projects instead.
   */
  const walkMerge = (node: YamlNode | null | undefined, path: JsonPath): void => {
    forEachSource(node, (source) => {
      for (const [key, value] of projectedPairs(source)) {
        const childPath = [...path, key]
        if (!index.has(pathKey(childPath))) walk(value, childPath)
      }
    })
  }

  const walk = (node: YamlNode | null | undefined, path: JsonPath): void => {
    if (node == null || budget-- <= 0) return
    index.set(pathKey(path), { path, range: rangeOf(node) })
    if (isScalar(node)) {
      const value = node.value
      if (typeof value === 'number' && !Number.isFinite(value)) nonFinite.push({ start: node.start, end: node.end })
      return
    }
    const target = isAlias(node) ? node.target : node
    if (target == null) return
    if (isMap(target)) {
      const merges: (YamlNode | null)[] = []
      for (const item of target.items) {
        if (!isPair(item)) continue
        if (isMergePair(item)) {
          merges.push(item.value)
          continue
        }
        walk(item.value, [...path, keyText(item.key)])
      }
      for (const merge of merges) walkMerge(merge, path)
    } else if (isSeq(target)) {
      target.items.forEach((item, i) => {
        walk(item, [...path, i])
      })
    }
  }

  if (docs.length > 1) {
    docs.forEach((doc, i) => {
      walk(doc.contents, [i])
    })
  } else if (docs[0]) {
    walk(docs[0].contents, [])
  }

  const lookup = (path: JsonPath, closest = false): { range: IRange } | undefined => {
    const p = path.slice()
    while (true) {
      const entry = index.get(pathKey(p))
      if (entry) return { range: entry.range }
      if (!closest || p.length === 0) return undefined
      p.pop()
    }
  }

  return { index, lookup, nonFinite, exhausted: budget <= 0 }
}

/**
 * Paths the eager index never held, derived from the ones it did: a missing
 * child, out-of-range and non-canonical indices, a `<<` segment, and every
 * all-digit segment spelled the other way (number for string and back), since a
 * finding's path spells a `"200"` key as `200`.
 */
const probesFor = (paths: JsonPath[]): JsonPath[] => {
  const probes: JsonPath[] = [[], [0], ['0'], [1], [99], ['<<'], ['missing']]
  for (const path of paths) {
    probes.push([...path, 'missing'], [...path, 0], [...path, '0'], [...path, 99_999], [...path, '01'], [...path, '<<'])
    const flipped = path.map((segment) =>
      typeof segment === 'number' ? String(segment) : /^\d+$/.test(segment) ? Number(segment) : segment,
    )
    probes.push(flipped, [...flipped, 'missing'])
  }
  return probes
}

/** A compact, comparable spelling of a lookup result. */
const describeLocation = (location: { range: IRange } | undefined): string =>
  location === undefined
    ? 'none'
    : `${location.range.start.line}:${location.range.start.character}-${location.range.end.line}:${location.range.end.character}`

/**
 * Asserts the lazy lookup answers every path the eager index held with the same
 * range, and every probe outside it the same way — exact and `closest`.
 * Mismatches are collected rather than asserted one by one: the large fixtures
 * hold hundreds of thousands of paths, and a per-path `expect` made the
 * comparison itself the slow part.
 */
const expectSameLocations = (source: string, uniqueKeys = true): number => {
  const reference = eagerReference(source, uniqueKeys)
  expect(reference.exhausted).toBe(false)
  const { getLocationForJsonPath } = parseYaml(source, uniqueKeys ? {} : { duplicateKeys: 'off' })
  const mismatches: string[] = []
  const compare = (path: JsonPath, closest: boolean, expected: { range: IRange } | undefined): void => {
    const actual = describeLocation(getLocationForJsonPath(path, closest))
    const wanted = describeLocation(expected)
    if (actual !== wanted && mismatches.length < 10) {
      mismatches.push(`${JSON.stringify(path)}${closest ? ' (closest)' : ''}: ${actual}, eager ${wanted}`)
    }
  }
  const paths = [...reference.index.values()].map((entry) => entry.path)
  for (const entry of reference.index.values()) {
    compare(entry.path, false, { range: entry.range })
    compare(entry.path, true, { range: entry.range })
  }
  for (const probe of probesFor(paths)) {
    compare(probe, false, reference.lookup(probe))
    compare(probe, true, reference.lookup(probe, true))
  }
  expect(mismatches).toEqual([])
  return paths.length
}

/** The ranges of the non-finite values `parseYaml` reports, in report order. */
const reportedNonFinite = (source: string, uniqueKeys = true): IRange[] =>
  parseYaml(source, {
    incompatibleValues: DiagnosticSeverity.Warning,
    ...(uniqueKeys ? {} : { duplicateKeys: 'off' as const }),
  })
    .diagnostics.filter((d) => d.code === 'INCOMPATIBLE_VALUE')
    .map((d) => d.range)

/**
 * The eager walk's non-finite reports, with the repeats it made for a value
 * reached along several alias paths (identical diagnostics) collapsed to the
 * first.
 */
const eagerNonFinite = (source: string, uniqueKeys = true): IRange[] => {
  const lineMap = createLineMap(source)
  const seen = new Set<number>()
  const unique: IRange[] = []
  for (const { start, end } of eagerReference(source, uniqueKeys).nonFinite) {
    if (seen.has(start)) continue
    seen.add(start)
    unique.push({ start: lineMap.positionAt(start), end: lineMap.positionAt(end) })
  }
  return unique
}

/** Every `.yaml`/`.yml` file under a fixtures directory. */
const yamlFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return yamlFilesUnder(full)
    return /\.ya?ml$/.test(name) ? [full] : []
  })

const fixturesRoot = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))
const fixtureFiles = [
  ...yamlFilesUnder(join(fixturesRoot, 'openapi')),
  ...yamlFilesUnder(join(fixturesRoot, 'asyncapi')),
]

/** Hand-written documents for every special case the eager walk handled. */
const edgeCases: Record<string, string> = {
  'merge from an alias, explicit key wins': 'base: &b {a: 1, b: 2}\nx:\n  <<: *b\n  a: 3\n',
  'explicit key after the merge still wins': 'base: &b {a: 1, b: 2}\nx:\n  a: 3\n  <<: *b\n',
  'merge list, earlier source wins': 'a: &a {k: 1}\nb: &b {k: 2, j: 3}\nc: {<<: [*a, *b]}\n',
  'inline merge map': 'x: {<<: {a: 1, n: {deep: [1, 2]}}, b: 2}\n',
  "a merge source's own keys beat what it merges":
    'm0: &m0 {k: 0}\nm1: &m1 {k2: 1, <<: *m0, k: 5}\nm2: &m2 {k: 6, <<: *m0}\nx: {<<: *m1}\ny: {<<: *m2}\n',
  'nested merge written before the explicit key': 'b: &b {a: 2}\ns: &s {<<: *b, a: 1}\nm: {<<: *s}\n',
  'duplicate key inside a merge source': 'x: {<<: {a: 1, a: {z: 2}}}\ny: {<<: [{a: }, {<<: {a: 3}, a: 4}]}\n',
  'tagged merge sources project no keys': 'x: {<<: !!set {a, b}, c: 1}\ny: {<<: !!omap [{a: 1}], <<: {a: 2}}\n',
  'merge of merges': 'a: &a {k: 1}\nb: &b {<<: [*a, *a], j: 2}\nc: &c {<<: [*b, *a]}\nd: {<<: *c, e: {<<: *c}}\n',
  'merged keys with empty values':
    'base: &b {a: , c: 1}\nx: {<<: *b, a: 2}\ny: {<<: [{a: }, {a: 3}]}\nz:\n  <<: {a: 1}\n  a:\n',
  'merge of a sequence item and a scalar': 'x: {<<: [1, {a: 2}, *nope]}\ny: {<<: }\nz: {<<: 5, a: 1}\n',
  'merge through an alias of a list': 'l: &l [{a: 1}, {b: 2}]\nx: {<<: *l}\n',
  'merged nested collections': 'base: &b {n: {inner: [1, {x: 2}]}}\nx: {<<: *b}\ny: {<<: *b, n: {other: 1}}\n',
  'aliases keep their own range': 'a: &x {k: [1, 2]}\nb: *x\nc: [*x, *x]\nd: *nope\ne: &s 5\nf: *s\n',
  'redefined anchor': 'a: &x {k: 1}\nb: *x\nc: &x {j: 2}\nd: *x\n',
  'duplicate keys, last write wins': 'a: {x: 1}\na: {y: 2}\nb: 1\nb:\nc: [1]\nc: {"0": 2, "1": 3}\n',
  'duplicates across a merge': 'a: {x: 1}\na: {<<: {x: 2, y: 3}}\nb: {<<: {x: 1}}\nb: {x: 2}\n',
  'duplicates reached through aliases': 'm: &m {k: 1, k: {z: 2}}\nd: *m\nd: {j: 2}\ne: [*m, *m]\n',
  'multi-document stream': 'a: 1\n---\nb: [1, 2]\n---\n---\n- {c: 3}\n',
  'multi-document stream with anchors': '---\na: &x {k: 1}\n---\nb: {<<: {j: 1}}\n...\n---\nfinal\n',
  'collection and alias keys': 'base: &k name\n? [a, b]\n: 1\n*k : 2\n~: 3\n? {m: 1}\n: {n: 2}\n',
  'numeric and odd keys': '200: ok\n"201": {x: 1}\n1.5: x\n0x10: y\ntrue: t\n"": e\n"a.b": 1\n"": again\n',
  'empty values': 'a:\nb: ~\nc: ""\nd: []\ne: {}\nf:\n  -\n  - x\n  - \n',
  'sequences of sequences': '- [1, [2, [3, {a: [4]}]]]\n- - x\n  - - y\n',
  'root scalar': 'hello\n',
  'root alias-free sequence': '- 1\n- 2\n',
  'empty source': '',
  'comment only': '# nothing here\n',
  'CR line breaks': 'a: 1\rb:\r  c: &x [1, 2]\r  d: *x\r  <<: {e: 3}\r',
  'CRLF line breaks': 'a: 1\r\nb:\r\n  c: &x [1, 2]\r\n  d: *x\r\n  <<: {e: 3}\r\n---\r\nz: 1\r\n',
  'quoted merge key is an ordinary key': 'x: {"<<": {a: 1}, b: 2}\n',
  'block scalars': 'a: |\n  text\n  more\nb: >\n  folded\nc: [x]\n',
}

/** A tiny deterministic PRNG so the generated corpus is the same on every run. */
const prng = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff
    return state / 0x80000000
  }
}

/**
 * Generates flow-style YAML leaning hard on the cases that make the index
 * subtle — few distinct keys (so duplicates and merge collisions are common),
 * anchors, aliases to earlier anchors, `<<` merges of maps, lists and aliases,
 * and non-finite values.
 */
const generateDocument = (random: () => number): string => {
  const anchors: string[] = []
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
  const value = (depth: number): string => {
    const roll = random()
    if (depth > 3 || roll < 0.3) return pick(['1', 'x', '.nan', '-.inf', '~', '', "'0'", '2'])
    if (roll < 0.42 && anchors.length > 0) return `*${pick(anchors)}`
    const anchor = random() < 0.35 ? `a${anchors.length}` : undefined
    const prefix = anchor ? `&${anchor} ` : ''
    let body: string
    if (roll < 0.62) {
      const items = Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1))
      body = `[${items.join(', ')}]`
    } else {
      const pairs = Array.from({ length: Math.floor(random() * 5) }, () => {
        if (random() < 0.25) {
          const sources = Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
            anchors.length > 0 && random() < 0.7 ? `*${pick(anchors)}` : value(depth + 1),
          )
          return `<<: ${sources.length === 1 ? sources[0] : `[${sources.join(', ')}]`}`
        }
        return `${pick(['a', 'b', '0', '1', '"1"'])}: ${value(depth + 1)}`
      })
      body = `{${pairs.join(', ')}}`
    }
    if (anchor) anchors.push(anchor)
    return `${prefix}${body}`
  }
  const docs = Array.from({ length: random() < 0.2 ? 2 : 1 }, () => `root: ${value(0)}\nnext: ${value(0)}\n`)
  return docs.join('---\n')
}

/** A locator over `source` with test knobs, as `parseYaml` builds it. */
const locatorFor = (source: string, options: YamlLocatorOptions = {}) =>
  createYamlLocator(parseAllDocuments(source, { uniqueKeys: false }), createLineMap(source), options)

/**
 * Generates flow-style YAML made of merges: every map key is unique within its
 * map and every value is written, so each path of the data names exactly one
 * node. Merges come as aliases, inline maps, and lists, sit anywhere among the
 * explicit keys (so a nested `<<` is often written before the key it collides
 * with), and a map can hold more than one. Scalars are unique strings apart
 * from the non-finite ones, so a scalar the lookup lands on identifies itself.
 */
const generateMergeDocument = (random: () => number): string => {
  const mapAnchors: string[] = []
  const anchors: string[] = []
  let scalars = 0
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
  const mergeSource = (depth: number): string => {
    const roll = random()
    if (mapAnchors.length > 0 && roll < 0.55) return `*${pick(mapAnchors)}`
    if (mapAnchors.length > 1 && roll < 0.75) {
      return `[${Array.from({ length: 2 + Math.floor(random() * 2) }, () => `*${pick(mapAnchors)}`).join(', ')}]`
    }
    return map(depth + 1)
  }
  const map = (depth: number): string => {
    // Laid out first and filled in written order, so an alias only ever names
    // an anchor written before it.
    const slots: (string | undefined)[] = ['a', 'b', 'c', 'd', '0'].filter(() => random() < 0.5)
    for (let merges = Math.floor(random() * 3); merges > 0; merges--) {
      slots.splice(Math.floor(random() * (slots.length + 1)), 0, undefined)
    }
    const pairs = slots.map((key) => (key === undefined ? `<<: ${mergeSource(depth)}` : `${key}: ${value(depth + 1)}`))
    const anchor = random() < 0.5 ? `m${mapAnchors.length}` : undefined
    if (anchor) {
      mapAnchors.push(anchor)
      anchors.push(anchor)
    }
    return `${anchor ? `&${anchor} ` : ''}{${pairs.join(', ')}}`
  }
  const value = (depth: number): string => {
    const roll = random()
    if (depth > 4 || roll < 0.3) return random() < 0.15 ? pick(['.inf', '-.inf', '.nan']) : `v${scalars++}`
    if (roll < 0.4 && anchors.length > 0) return `*${pick(anchors)}`
    if (roll < 0.5) {
      const items = Array.from({ length: Math.floor(random() * 3) }, () => value(depth + 1))
      const anchor = `s${anchors.length}`
      anchors.push(anchor)
      return `&${anchor} [${items.join(', ')}]`
    }
    return map(depth)
  }
  const lines: string[] = []
  for (let i = 0; i < 6; i++) lines.push(`k${i}: ${value(0)}`)
  return `${lines.join('\n')}\n`
}

/**
 * The real invariant behind the lookup: for every path in the data `toJS`
 * produced, the node the lookup lands on projects to the value at that path —
 * the same scalar (unique in these documents), or a collection of the same
 * kind whose own paths are checked in turn. Non-finite values are checked the
 * same way, and the `incompatibleValues` scan must report exactly the scalars
 * the data holds them from. Returns how many paths it checked.
 */
const expectLocationsMatchData = (source: string): number => {
  const doc = parseAllDocuments(source)[0]
  if (!doc) throw new Error('no document')
  const lineMap = createLineMap(source)
  const describeNode = (node: YamlNode): string =>
    describeLocation({ range: { start: lineMap.positionAt(node.start), end: lineMap.positionAt(node.end) } })
  // Every value node by its range, to turn a located range back into nodes.
  const byRange = new Map<string, YamlNode[]>()
  const index = (node: YamlNode | null | undefined): void => {
    if (node == null) return
    const key = describeNode(node)
    byRange.set(key, [...(byRange.get(key) ?? []), node])
    if (isMap(node)) for (const pair of node.items) index(pair.value)
    else if (isSeq(node)) for (const item of node.items) index(item)
  }
  index(doc.contents)
  const lookup = locatorFor(source)
  const mismatches: string[] = []
  const nonFinite = new Set<string>()
  let checked = 0
  const check = (path: JsonPath, value: unknown): void => {
    if (checked++ > 400) return
    const location = describeLocation(lookup(path))
    const nodes = (byRange.get(location) ?? []).map((node) => (isAlias(node) ? node.target : node))
    const matches = nodes.some((node) => {
      if (node == null) return false
      if (Array.isArray(value)) return isSeq(node)
      if (value !== null && typeof value === 'object') return isMap(node)
      return isScalar(node) && Object.is(node.value, value)
    })
    if (!matches && mismatches.length < 5) mismatches.push(`${JSON.stringify(path)} -> ${location}, data ${value}`)
    if (typeof value === 'number' && !Number.isFinite(value)) {
      for (const node of nodes) if (node != null && isScalar(node)) nonFinite.add(describeNode(node))
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        check([...path, i], item)
      })
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) check([...path, key], item)
    }
  }
  check([], doc.toJS())
  expect(mismatches, source).toEqual([])
  // Only comparable when every path was walked, since the cap skips some.
  if (checked <= 400) {
    const reported = reportedNonFinite(source).map((range) => describeLocation({ range }))
    expect(new Set(reported), source).toEqual(nonFinite)
  }
  return checked
}

describe('yaml-lazy-positions', () => {
  it('finds the yaml fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThan(15)
  })

  for (const file of fixtureFiles) {
    it(`matches the eager index on ${file.slice(fixturesRoot.length)}`, () => {
      const source = readFileSync(file, 'utf8')
      expect(expectSameLocations(source)).toBeGreaterThan(0)
      expect(reportedNonFinite(source)).toEqual(eagerNonFinite(source))
    })
  }

  for (const [name, source] of Object.entries(edgeCases)) {
    it(`matches the eager index: ${name}`, () => {
      expectSameLocations(source)
      expectSameLocations(source, false)
    })
  }

  it('matches the eager index on generated merge, alias, and duplicate documents', () => {
    const random = prng(20_260_923)
    for (let i = 0; i < 600; i++) {
      const source = generateDocument(random)
      expectSameLocations(source)
      expectSameLocations(source, false)
      // Without duplicate keys the scan reports exactly the eager walk's values,
      // once each. With them, the eager walk could miss a value hidden behind a
      // cross-duplicate merge collision (see below), so only containment holds.
      const eager = eagerNonFinite(source, false)
      const lazy = reportedNonFinite(source, false)
      if (parseAllDocuments(source).every((doc) => doc.errors.every((e) => e.code !== 'DUPLICATE_KEY'))) {
        expect(lazy, source).toEqual(eager)
      } else {
        expect(lazy, source).toEqual(expect.arrayContaining(eager))
      }
    }
  })

  it('resolves a path that exists only under an earlier duplicate key', () => {
    // The eager index was keyed by path text, so the first `a`'s subtree stayed
    // reachable after the second `a` overwrote `['a']`.
    const { getLocationForJsonPath } = parseYaml('a: {x: 1}\na: {y: 2}\n', { duplicateKeys: 'off' })
    expect(getLocationForJsonPath(['a'])?.range.start).toEqual({ line: 1, character: 3 })
    expect(getLocationForJsonPath(['a', 'x'])?.range.start).toEqual({ line: 0, character: 7 })
    expect(getLocationForJsonPath(['a', 'y'])?.range.start).toEqual({ line: 1, character: 7 })
  })

  it('resolves merged keys into the merge source, explicit keys first', () => {
    const source = 'base: &b {a: 1, b: 2}\nx:\n  <<: *b\n  a: 3\n'
    const { getLocationForJsonPath } = parseYaml(source)
    expect(getLocationForJsonPath(['x', 'a'])?.range.start).toEqual({ line: 3, character: 5 })
    expect(getLocationForJsonPath(['x', 'b'])?.range.start).toEqual({ line: 0, character: 19 })
    expect(getLocationForJsonPath(['x', '<<'])).toBeUndefined()
    expect(getLocationForJsonPath(['x', '<<'], true)?.range.start).toEqual({ line: 2, character: 2 })
  })

  it('keeps the alias range and descends into the anchored node beneath it', () => {
    const { getLocationForJsonPath } = parseYaml('a: &x {k: [1, 2]}\nb: *x\n')
    expect(getLocationForJsonPath(['b'])?.range).toEqual({
      start: { line: 1, character: 3 },
      end: { line: 1, character: 5 },
    })
    expect(getLocationForJsonPath(['b', 'k', 1])?.range.start).toEqual({ line: 0, character: 14 })
  })

  it('prefixes paths with the document index in a stream', () => {
    const { getLocationForJsonPath } = parseYaml('a: 1\n---\nb: [1, 2]\n')
    expect(getLocationForJsonPath([])).toBeUndefined()
    expect(getLocationForJsonPath([], true)).toBeUndefined()
    expect(getLocationForJsonPath([1, 'b', '1'])?.range.start).toEqual({ line: 2, character: 7 })
    expect(getLocationForJsonPath(['1', 'b', 5], true)?.range.start).toEqual({ line: 2, character: 3 })
    expect(getLocationForJsonPath([2, 'b'], true)).toBeUndefined()
  })

  it('answers a lookup under a value alias bomb without expanding it', () => {
    // The eager walk had to cap this with a whole-stream budget; a lookup only
    // follows the one path it was asked for.
    let source = 'a0: &a0 ["x","x","x","x","x","x","x","x","x","x"]\n'
    for (let i = 1; i <= 10; i++) {
      source += `a${i}: &a${i} [${Array.from({ length: 10 }, () => `*a${i - 1}`).join(',')}]\n`
    }
    source += 'b: *a10\n'
    const started = performance.now()
    const { getLocationForJsonPath } = parseYaml(source)
    const location = getLocationForJsonPath(['b', 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(location?.range.start).toEqual({ line: 0, character: 45 })
  })

  it('bounds a lookup through duplicate keys that multiply at every level', () => {
    // Each level holds its key twice, both aliasing the level below, so the
    // candidates double per segment: 2^40 if every copy were followed.
    const lines = ['l0: &l0 {k: 1}']
    for (let level = 1; level <= 40; level++) lines.push(`l${level}: &l${level} {k: *l${level - 1}, k: *l${level - 1}}`)
    const source = `${lines.join('\n')}\n`
    const path = ['l40', ...Array(40).fill('k')]
    // `l40` followed by forty `k`s is `l1`'s second `*l0`: the value the data
    // holds, and the last write of the eager index.
    const expected = { start: { line: 1, character: 20 }, end: { line: 1, character: 23 } }
    const stats = { visits: 0 }
    const lookup = locatorFor(source, { stats })
    expect(lookup(path, true)?.range).toEqual(expected)
    expect(lookup(path)?.range).toEqual(expected)
    // Folding repeated candidates keeps every level at two of them.
    expect(stats.visits).toBeLessThan(2 * 10 * path.length)
    // And a lookup that does run out lands on the same node.
    const starved = locatorFor(source, { maxVisits: 10 })
    expect(starved(path, true)?.range).toEqual(expected)
    expect(starved(path)?.range).toEqual(expected)
    expect(starved([...path, 'missing'], true)?.range).toEqual(expected)
    expect(starved([...path, 'missing'])).toBeUndefined()
  })

  it('keeps a lookup through aliased duplicate keys linear', () => {
    // `r.k` holds `*A` many times over, and `A.k` holds `*E` as many times with
    // `*Y` last, so following every copy is quadratic — and past the budget,
    // the old fallback kept the *first* candidates and put a finding for `f4`
    // on a shadowed `*E`.
    const copies = 100
    const lines = ['e: &E {}', 'y: &Y']
    for (let i = 0; i < 10; i++) lines.push(`  f${i}: ${i}`)
    lines.push('a: &A', ...Array(copies - 1).fill('  k: *E'), '  k: *Y', 'r:', ...Array(copies).fill('  k: *A'))
    const source = `${lines.join('\n')}\n`
    const expected = { start: { line: 6, character: 6 }, end: { line: 6, character: 7 } }
    const stats = { visits: 0 }
    const lookup = locatorFor(source, { stats })
    expect(lookup(['r', 'k', 'k', 'f4'])?.range).toEqual(expected)
    expect(stats.visits).toBeLessThan(4 * copies)
    // Starved of budget, the lookup falls back to following the data.
    const starved = locatorFor(source, { maxVisits: 50 })
    expect(starved(['r', 'k', 'k', 'f4'])?.range).toEqual(expected)
    expect(starved(['r', 'k', 'k', 'nope'], true)?.range).toEqual(locatorFor(source)(['r', 'k', 'k'])?.range)
  })

  it('scans a merge source once, not once per candidate per lookup', () => {
    // The shape that made the first lazy lookup quadratic: every `k` of `r` but
    // the last aliases `X`, which merges a wide `big`, so each lookup under
    // `r.k` asked `big` for the key once per copy of `*X`.
    const copies = 200
    const lines = ['big: &big', ...Array.from({ length: copies }, (_, i) => `  b${i}: ${i}`)]
    lines.push('x: &X', '  <<: *big', 'y: &Y', ...Array.from({ length: 50 }, (_, i) => `  f${i}: ${i}`))
    lines.push('r:', ...Array(copies - 1).fill('  k: *X'), '  k: *Y')
    const source = `${lines.join('\n')}\n`
    const stats = { visits: 0 }
    const lookup = locatorFor(source, { stats })
    for (let i = 0; i < 50; i++) {
      expect(lookup(['r', 'k', `f${i}`])?.range.start).toEqual({
        line: copies + 4 + i,
        character: 5 + String(i).length,
      })
    }
    // One pass over `r`'s explicit `k`s per lookup, plus a handful of steps.
    expect(stats.visits).toBeLessThan(50 * (copies + 20))
  })

  it('follows toJS for a nested merge written before an explicit key', () => {
    const source = 'b: &b {a: 2}\ns: &s {<<: *b, a: 1}\nm: {<<: *s}\n'
    const { data, getLocationForJsonPath } = parseYaml<{ m: { a: number } }>(source)
    expect(data.m.a).toBe(1)
    expect(getLocationForJsonPath(['m', 'a'])?.range).toEqual({
      start: { line: 1, character: 18 },
      end: { line: 1, character: 19 },
    })
    // A duplicated key inside the source: `toJS` keeps the last one.
    const dup = parseYaml<{ x: { a: unknown } }>('x: {<<: {a: 1, a: 2}}\n', { duplicateKeys: 'off' })
    expect(dup.data.x.a).toBe(2)
    expect(dup.getLocationForJsonPath(['x', 'a'])?.range.start).toEqual({ line: 0, character: 18 })
  })

  it('reports a non-finite value a merge source projects over its own nested merge', () => {
    const source = 'b: &b {a: 1}\nm: {<<: {<<: *b, a: .inf}}\n'
    const { data, diagnostics } = parseYaml<{ m: { a: number } }>(source, {
      incompatibleValues: DiagnosticSeverity.Warning,
    })
    expect(data.m.a).toBe(Number.POSITIVE_INFINITY)
    expect(diagnostics.map((d) => [d.code, d.range.start])).toEqual([
      ['INCOMPATIBLE_VALUE', { line: 1, character: 20 }],
    ])
    // And the value a source's explicit key overrides is not reported.
    const overridden = parseYaml('m: {<<: {<<: {a: .nan}, a: 1}}\n', {
      incompatibleValues: DiagnosticSeverity.Warning,
    })
    expect(overridden.diagnostics).toEqual([])
  })

  it('locates the node toJS projects each path from, on generated merge-heavy documents', () => {
    const random = prng(20_260_924)
    let checked = 0
    for (let i = 0; i < 400; i++) {
      const source = generateMergeDocument(random)
      checked += expectLocationsMatchData(source)
    }
    // Enough paths went through the check for it to mean something.
    expect(checked).toBeGreaterThan(10_000)
  })

  it('reports every non-finite value once, however many aliases or merges reach it', () => {
    const source = 'a: .nan\nb: [.inf, -.inf]\nc: &n {v: .nan}\nd: *n\ne: [*n, *n]\nf: {<<: *n}\ng: &s .inf\nh: *s\n'
    const { diagnostics } = parseYaml(source, { incompatibleValues: DiagnosticSeverity.Warning })
    expect(diagnostics.map((d) => [d.code, d.message, d.range.start])).toEqual([
      [
        'INCOMPATIBLE_VALUE',
        'Value NaN cannot be represented in JSON and will serialize to null.',
        { line: 0, character: 3 },
      ],
      [
        'INCOMPATIBLE_VALUE',
        'Value Infinity cannot be represented in JSON and will serialize to null.',
        { line: 1, character: 4 },
      ],
      [
        'INCOMPATIBLE_VALUE',
        'Value -Infinity cannot be represented in JSON and will serialize to null.',
        { line: 1, character: 10 },
      ],
      [
        'INCOMPATIBLE_VALUE',
        'Value NaN cannot be represented in JSON and will serialize to null.',
        { line: 2, character: 10 },
      ],
      [
        'INCOMPATIBLE_VALUE',
        'Value Infinity cannot be represented in JSON and will serialize to null.',
        { line: 6, character: 6 },
      ],
    ])
  })

  it('does not report a merged value an explicit key overrides', () => {
    const { diagnostics } = parseYaml('x: {<<: {a: .nan, b: .inf}, a: 1}\n', {
      incompatibleValues: DiagnosticSeverity.Warning,
    })
    expect(diagnostics.map((d) => d.range.start)).toEqual([{ line: 0, character: 21 }])
  })

  it('reports a merged value that lands in the data behind a duplicate key', () => {
    // The eager walk claimed `['a', 'x']` for the first `a` and so skipped the
    // second `a`'s merged `x` — the value `toJS` actually keeps.
    const source = 'a: {x: 1}\na: {<<: {x: .nan}}\n'
    const { data, diagnostics } = parseYaml<{ a: { x: number } }>(source, {
      duplicateKeys: 'off',
      incompatibleValues: DiagnosticSeverity.Warning,
    })
    expect(data.a.x).toBeNaN()
    expect(diagnostics.map((d) => d.range.start)).toEqual([{ line: 1, character: 12 }])
  })

  it('reports non-finite values in every document of a stream, before its parser errors', () => {
    const { diagnostics } = parseYaml('a: .nan\n---\nb: .inf\nb: 1\n', { incompatibleValues: DiagnosticSeverity.Error })
    expect(diagnostics.map((d) => [d.code, d.range.start.line])).toEqual([
      ['INCOMPATIBLE_VALUE', 0],
      ['INCOMPATIBLE_VALUE', 2],
      ['DUPLICATE_KEY', 3],
    ])
  })

  it('leaves the non-finite check off by default', () => {
    expect(parseYaml('a: .nan\n').diagnostics).toEqual([])
  })

  it('places lint findings on the paths the eager index did', async () => {
    const source = 'base: &b {description: ""}\ninfo:\n  <<: *b\n  title: t\nlist: [*b, {description: x}]\n'
    const findings = await lintDocument(source, {
      ruleset: {
        rules: {
          'no-empty-description': {
            given: '$..description',
            severity: 'error',
            then: { function: 'truthy' },
          },
        },
      },
    })
    const reference = eagerReference(source)
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(finding.range).toEqual(reference.lookup(finding.path ?? [], true)?.range)
    }
  })
})
