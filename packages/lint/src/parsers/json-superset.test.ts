import { describe, expect, it } from 'vitest'

import { parseJson } from './json'
import type { JsonPath } from './types'
import { parseYaml } from './yaml'

/**
 * `parseYaml` documents itself as handling both formats — "YAML (a JSON superset, so
 * this handles both)" — and `detectFormat` routes on that: a `.json` document may end
 * up in either parser depending on how it was detected and what the caller passed.
 * That only holds if the two agree, so this pins the agreement.
 *
 * Agreement means all three things a `IParseResult` carries, because a ruleset reads
 * all three: the projected `data`, the `diagnostics` (a JSON document is valid input
 * to either parser, so both must stay silent), and — the part that is easy to get
 * subtly wrong — `getLocationForJsonPath` for *every* path in the document. A finding
 * whose range comes out one parser's way and not the other's points a squiggle at the
 * wrong node, which is the failure mode this package exists to avoid.
 */

/** Every path reachable in a value, so both parsers can be asked to locate all of them. */
const paths = (value: unknown, prefix: JsonPath = []): JsonPath[] => {
  const out: JsonPath[] = [prefix]
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) out.push(...paths(item, [...prefix, i]))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) out.push(...paths(child, [...prefix, key]))
  }
  return out
}

/** Everything the two parsers disagreed about for `source`; empty when they agree. */
const disagreements = (source: string): string[] => {
  const json = parseJson(source)
  const yaml = parseYaml(source)
  const out: string[] = []
  if (JSON.stringify(json.data) !== JSON.stringify(yaml.data)) {
    out.push(`data: json=${JSON.stringify(json.data)} yaml=${JSON.stringify(yaml.data)}`)
  }
  for (const [name, result] of [
    ['json', json],
    ['yaml', yaml],
  ] as const) {
    if (result.diagnostics.length > 0)
      out.push(`${name} reported: ${result.diagnostics.map((d) => d.message).join(', ')}`)
  }
  for (const path of paths(json.data)) {
    const fromJson = JSON.stringify(json.getLocationForJsonPath(path))
    const fromYaml = JSON.stringify(yaml.getLocationForJsonPath(path))
    if (fromJson !== fromYaml) out.push(`range at [${path.join(', ')}]: json=${fromJson} yaml=${fromYaml}`)
  }
  return out.map((entry) => `${JSON.stringify(source.slice(0, 80))}: ${entry}`)
}

/** Each spelling a JSON document arrives in — indentation and line endings both vary. */
const spellings = (value: unknown): string[] => {
  const pretty = JSON.stringify(value, null, 2)
  return [JSON.stringify(value), pretty, JSON.stringify(value, null, '\t'), pretty.replace(/\n/g, '\r\n')]
}

/** Deterministic PRNG, so a failure is reproducible from its seed. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

const KEYS = [
  'a',
  'key',
  '',
  '0',
  'null',
  '<<',
  '__proto__',
  'a: b',
  '- d',
  '# h',
  '[b]',
  'a,b',
  '*s',
  'é😀',
  'tab\there',
]
const LEAVES: unknown[] = [
  null,
  true,
  false,
  0,
  -1,
  1.5,
  '',
  'plain',
  'a: b',
  '#h',
  ' lead',
  'trail ',
  'multi\nline',
  'é😀',
]

const build = (next: () => number, depth: number): unknown => {
  const roll = next()
  if (depth <= 0 || roll < 0.45) return LEAVES[Math.floor(next() * LEAVES.length)]
  const size = Math.floor(next() * 4)
  if (roll < 0.72) return Array.from({ length: size }, () => build(next, depth - 1))
  const out: Record<string, unknown> = {}
  // Indexed key names keep them distinct: a duplicate key is where the two parsers
  // legitimately differ (JSON keeps the last one silently, YAML reports it), which is
  // a documented option rather than something this corpus should measure.
  for (let i = 0; i < size; i++) out[`${KEYS[Math.floor(next() * KEYS.length)]}${i}`] = build(next, depth - 1)
  return out
}

describe('JSON superset', () => {
  it('agrees on a compact JSON object', () => {
    expect(disagreements('{"a":1,"b":{"c":[1,2]}}')).toEqual([])
  })

  it('agrees on pretty-printed JSON, where the ranges span several lines', () => {
    expect(disagreements('{\n  "a": 1,\n  "b": {\n    "c": [1, 2]\n  }\n}')).toEqual([])
  })

  it('agrees on tab-indented JSON', () => {
    expect(disagreements('{\n\t"a": 1,\n\t"b": [\n\t\t1,\n\t\t-1\n\t]\n}')).toEqual([])
  })

  it('agrees on CRLF-delimited JSON', () => {
    expect(disagreements('{\r\n  "a": 1,\r\n  "b": 2\r\n}')).toEqual([])
  })

  it('agrees on keys that are YAML indicators', () => {
    expect(disagreements('{"":1,"a:b":2,"__proto__":3,"<<":4,"- d":5}')).toEqual([])
  })

  it('agrees on a top-level JSON scalar', () => {
    for (const source of ['"a string"', '42', 'true', 'null']) expect(disagreements(source)).toEqual([])
  })

  it('agrees on every generated JSON document, in every spelling', () => {
    const next = rng(20260801)
    const found: string[] = []
    for (let i = 0; i < 400; i++) {
      for (const source of spellings(build(next, 4))) found.push(...disagreements(source))
    }
    expect(found).toEqual([])
  })
})
