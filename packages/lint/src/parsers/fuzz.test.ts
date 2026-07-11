import { describe, expect, it } from 'vitest'

import { applyEditOps, type EditOp, type JsonPath, type ParserFormat, parseJson, parseWithPointers } from './index'

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

// --- Edit-op round-trip property test --------------------------------------
//
// The strongest guarantee the edit model can offer is that every op is a
// *structure-preserving text edit*: applying it should produce a document that
// (a) still parses with no new errors, (b) projects to exactly the structural
// mutation the op describes, and (c) leaves the bytes of untouched siblings
// alone. We derive random-but-valid ops from real parsed documents and assert
// all three, so any regression that corrupts the source is caught even for
// shapes no hand-written case covers.

/** A tiny deterministic PRNG (mulberry32) so the fuzz corpus is reproducible. */
const makeRng = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const getAt = (data: unknown, path: JsonPath): unknown =>
  path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) return current[Number(segment)]
    if (isObject(current)) return current[String(segment)]
    return undefined
  }, data)

/** Applies `op` to a clone of `data`, returning the expected post-edit structure. */
const applyToData = (data: unknown, op: EditOp): unknown => {
  const next = structuredClone(data)
  const parent = getAt(next, op.path.slice(0, -1))
  const target = getAt(next, op.path)
  const lastKey = op.path[op.path.length - 1]
  switch (op.op) {
    case 'setValue':
      if (Array.isArray(parent)) parent[Number(lastKey)] = op.value
      else if (isObject(parent)) parent[String(lastKey)] = op.value
      break
    case 'removeProperty':
      if (isObject(parent)) delete parent[String(lastKey)]
      break
    case 'insertProperty':
      if (isObject(target)) target[op.key] = op.value
      break
    case 'removeItems':
      if (Array.isArray(target)) {
        const removed = new Set(op.indices)
        const kept = target.filter((_, index) => !removed.has(index))
        target.length = 0
        target.push(...kept)
      }
      break
    case 'insertItem':
      if (Array.isArray(target)) target.splice(op.index ?? target.length, 0, op.value)
      break
    case 'reorderArray':
      if (Array.isArray(target)) {
        const reordered = op.order.map((index) => target[index])
        target.length = 0
        target.push(...reordered)
      }
      break
  }
  return next
}

/** Every path to a scalar leaf (string/number/bool/null) within `data`. */
const scalarPaths = (data: unknown, base: JsonPath = []): JsonPath[] => {
  if (Array.isArray(data)) return data.flatMap((item, index) => scalarPaths(item, [...base, index]))
  if (isObject(data)) return Object.entries(data).flatMap(([key, value]) => scalarPaths(value, [...base, key]))
  return [base]
}

/** Every path to a non-empty mapping. */
const mapPaths = (data: unknown, base: JsonPath = []): JsonPath[] => {
  if (Array.isArray(data)) return data.flatMap((item, index) => mapPaths(item, [...base, index]))
  if (isObject(data)) {
    const here = Object.keys(data).length > 0 ? [base] : []
    return here.concat(Object.entries(data).flatMap(([key, value]) => mapPaths(value, [...base, key])))
  }
  return []
}

/** Every path to a non-empty array. */
const seqPaths = (data: unknown, base: JsonPath = []): JsonPath[] => {
  if (Array.isArray(data)) {
    const here = data.length > 0 ? [base] : []
    return here.concat(data.flatMap((item, index) => seqPaths(item, [...base, index])))
  }
  if (isObject(data)) return Object.entries(data).flatMap(([key, value]) => seqPaths(value, [...base, key]))
  return []
}

// A mix of benign and adversarial scalar values, so the round-trip exercises the
// re-quoting guard (a string that reads as a bool/number/null or carries `: `,
// ` #`, or a newline must come back as the same string).
const VALUE_POOL: unknown[] = [
  'x',
  'hello world',
  'true',
  '123',
  '',
  'a: b',
  'has #hash',
  'x\ny',
  42,
  -1,
  3.5,
  true,
  false,
]

/** Builds a random valid op for `data`, or `undefined` if no target of that kind exists. */
const randomOp = (rng: () => number, data: unknown, keySeed: number): EditOp | undefined => {
  const scalars = scalarPaths(data).filter((path) => path.length > 0)
  const maps = mapPaths(data)
  const seqs = seqPaths(data)
  const kinds: EditOp['op'][] = []
  if (scalars.length) kinds.push('setValue')
  if (maps.length) kinds.push('removeProperty', 'insertProperty')
  if (seqs.length) kinds.push('removeItems', 'insertItem', 'reorderArray')
  if (kinds.length === 0) return undefined

  switch (pick(rng, kinds)) {
    case 'setValue':
      return { op: 'setValue', path: pick(rng, scalars), value: pick(rng, VALUE_POOL) }
    case 'removeProperty': {
      const mapPath = pick(rng, maps)
      const key = pick(rng, Object.keys(getAt(data, mapPath) as Record<string, unknown>))
      return { op: 'removeProperty', path: [...mapPath, key] }
    }
    case 'insertProperty':
      return { op: 'insertProperty', path: pick(rng, maps), key: `k${keySeed}`, value: pick(rng, VALUE_POOL) }
    case 'removeItems': {
      const seqPath = pick(rng, seqs)
      const length = (getAt(data, seqPath) as unknown[]).length
      const indices = Array.from({ length }, (_, index) => index).filter(() => rng() < 0.5)
      if (indices.length === 0 || indices.length === length) return undefined
      return { op: 'removeItems', path: seqPath, indices }
    }
    case 'insertItem': {
      const seqPath = pick(rng, seqs)
      const length = (getAt(data, seqPath) as unknown[]).length
      return { op: 'insertItem', path: seqPath, value: pick(rng, VALUE_POOL), index: Math.floor(rng() * (length + 1)) }
    }
    case 'reorderArray': {
      const seqPath = pick(rng, seqs)
      const order = Array.from({ length: (getAt(data, seqPath) as unknown[]).length }, (_, index) => index)
      // Fisher–Yates with the seeded rng keeps the permutation reproducible.
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[order[i], order[j]] = [order[j] as number, order[i] as number]
      }
      return { op: 'reorderArray', path: seqPath, order }
    }
    default:
      return undefined
  }
}

/** A witness scalar in a different top-level branch than `path`, for a byte-identity check. */
const witnessOutside = (data: unknown, path: JsonPath): JsonPath | undefined =>
  scalarPaths(data).find((candidate) => candidate.length > 0 && candidate[0] !== path[0])

// Block-style documents with several independent top-level branches, so a witness
// sibling always exists and reformatting of one branch cannot excuse a change to
// another.
const ROUND_TRIP_CORPUS: { source: string; format: ParserFormat }[] = [
  { format: 'yaml', source: 'title: My API\nversion: 1.0.0\ncount: 3\n' },
  { format: 'yaml', source: 'info:\n  title: API\n  version: "1.0"\nhost: example.com\n' },
  { format: 'yaml', source: 'tags:\n  - alpha\n  - bravo\n  - charlie\nname: root\n' },
  { format: 'yaml', source: 'servers:\n  - name: a\n    url: one\n  - name: b\n    url: two\nkind: list\n' },
  { format: 'yaml', source: 'nums:\n  - 1\n  - 2\n  - 3\nlabel: numbers\n' },
  { format: 'yaml', source: 'flow: [red, green, blue]\nother: kept\n' },
  { format: 'json', source: '{\n  "title": "API",\n  "version": "1.0",\n  "count": 3\n}' },
  { format: 'json', source: '{\n  "tags": ["a", "b", "c"],\n  "name": "root"\n}' },
  { format: 'json', source: '{\n  "servers": [{ "url": "one" }, { "url": "two" }],\n  "kind": "list"\n}' },
]

/** Slices the exact source text a location covers (single-line spans only). */
const sliceLoc = (text: string, line: number, startChar: number, endChar: number): string =>
  (text.split(/\r\n|\n/)[line] ?? '').slice(startChar, endChar)

describe('edit-op round-trip property', () => {
  it('every random op re-parses cleanly and yields the expected structure', () => {
    const rng = makeRng(0x1234abcd)
    let insertCounter = 0
    let checkedByteIdentity = 0

    for (const { source, format } of ROUND_TRIP_CORPUS) {
      for (let iteration = 0; iteration < 120; iteration++) {
        const before = parseWithPointers(source, { format })
        const baselineErrors = before.diagnostics.filter((d) => d.severity === 0).length

        const op = randomOp(rng, before.data, insertCounter++)
        if (!op) continue

        const witness = witnessOutside(before.data, op.path)
        const witnessLoc = witness ? before.getLocationForJsonPath(witness) : undefined

        const output = applyEditOps(source, format, [op])
        const reparsed = parseWithPointers(output, { format })

        // (a) No new parser errors were introduced by the edit.
        const newErrors = reparsed.diagnostics.filter((d) => d.severity === 0).length
        expect(newErrors, `op ${JSON.stringify(op)} on ${JSON.stringify(source)} produced errors`).toBeLessThanOrEqual(
          baselineErrors,
        )

        // (b) The projected data is exactly the structural mutation the op describes.
        expect(reparsed.data, `op ${JSON.stringify(op)} on ${JSON.stringify(source)}`).toEqual(
          applyToData(before.data, op),
        )

        // (c) A sibling in an untouched branch keeps its exact source bytes.
        if (witness && witnessLoc) {
          const afterLoc = reparsed.getLocationForJsonPath(witness)
          expect(afterLoc, `witness ${JSON.stringify(witness)} vanished after ${JSON.stringify(op)}`).toBeDefined()
          if (afterLoc) {
            const originalText = sliceLoc(
              source,
              witnessLoc.range.start.line,
              witnessLoc.range.start.character,
              witnessLoc.range.end.character,
            )
            const editedText = sliceLoc(
              output,
              afterLoc.range.start.line,
              afterLoc.range.start.character,
              afterLoc.range.end.character,
            )
            expect(editedText, `sibling ${JSON.stringify(witness)} changed after ${JSON.stringify(op)}`).toBe(
              originalText,
            )
            checkedByteIdentity++
          }
        }
      }
    }

    // Guard against the generator silently degenerating into all-skips.
    expect(checkedByteIdentity).toBeGreaterThan(0)
  })
})
