import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'
import { makeRng, pick } from '#parsers/generators/differential.test-utils'
import { linkGenerated } from '#validators/generators/link-generated.test-utils'

import { generate } from './generate'

/**
 * `parseX` against `coerceX`, on the same schema and the same document.
 *
 * The two contracts part company only where `coerceX` has no answer: a document
 * no coercion can make valid is reported by `coerceX` and repaired by `parseX`.
 * Everywhere `coerceX` *accepts*, there is exactly one right value and both must
 * produce it — a coercing parser that turns `{ enabled: "true" }` into `false`
 * under a union, where `coerceX` answers `true`, has repaired a document that
 * needed no repair.
 *
 * Built through `generate` with both modes in one tree, the way a consumer gets
 * them: the parser half is rehomed next to the validator half, and the two
 * share one barrel.
 */

type Coerce = (input: unknown) => { valid: boolean; value?: unknown }
type Parse = (input: unknown) => unknown

const build = async (
  schema: JSONSchema,
): Promise<{ coerce: Coerce; parse: Parse; files: { filename: string; content: string }[] }> => {
  const files = await generate(schema, 'Root', {
    modes: ['types', 'guard', 'validate', 'coerce', 'parse'],
    helpersMode: 'embedded',
  })
  return {
    coerce: linkGenerated<Coerce>(files, 'index', 'coerceRoot'),
    parse: linkGenerated<Parse>(files, 'index', 'parseRoot'),
    files,
  }
}

/** Every document `coerceX` accepts that `parseX` answers differently. */
const disagreements = (coerce: Coerce, parse: Parse, values: readonly unknown[]): string[] =>
  values.flatMap((value) => {
    const coerced = coerce(structuredClone(value))
    if (!coerced.valid) return []
    const parsed = parse(structuredClone(value))
    return JSON.stringify(parsed) === JSON.stringify(coerced.value)
      ? []
      : [`${JSON.stringify(value)}: coerce=${JSON.stringify(coerced.value)} parse=${JSON.stringify(parsed)}`]
  })

const STRINGS = ['', 'a', 'abc', '1', '0', 'true', 'false', '1.5', 'x']
const NUMBERS = [-1, 0, 1, 2, 1.5, 10]

const randomValue = (rng: () => number, depth: number): unknown => {
  const p = rng()
  if (depth <= 0 || p < 0.5) {
    const leaf = rng()
    if (leaf < 0.1) return null
    if (leaf < 0.3) return rng() < 0.5
    if (leaf < 0.6) return pick(rng, STRINGS)
    return pick(rng, NUMBERS)
  }
  if (p < 0.65) return Array.from({ length: Math.floor(rng() * 3) }, () => randomValue(rng, depth - 1))
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'c']) if (rng() < 0.6) out[key] = randomValue(rng, depth - 1)
  return out
}

/** The same document with every number and boolean written as a string, the way a text format carries it. */
const stringifyScalars = (value: unknown): unknown => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyScalars)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, stringifyScalars(nested)]))
  }
  return value
}

const DEFS = ['d0', 'd1', 'd2']

/**
 * Random schemas over every keyword a coercion walks into. A `$ref` only ever
 * sits where it consumes the value — a property or an item — because one at the
 * top of a definition that names itself recurses without end in any validator.
 */
const randomSchema = (rng: () => number, withRefs: boolean): Record<string, unknown> => {
  const leaf = (): Record<string, unknown> => {
    if (rng() < 0.12) return { const: pick(rng, [false, true, 'x', 1]) }
    const type = pick(rng, ['string', 'number', 'integer', 'boolean'] as const)
    const node: Record<string, unknown> = { type }
    if (rng() < 0.2 && (type === 'integer' || type === 'number')) node['minimum'] = 1
    if (rng() < 0.2 && type === 'string') node['minLength'] = 2
    return node
  }
  const node = (depth: number, consuming = false): Record<string, unknown> => {
    if (withRefs && consuming && rng() < 0.2) return { $ref: `#/$defs/${pick(rng, DEFS)}` }
    if (depth <= 0 || rng() < 0.3) return leaf()
    const roll = rng()
    const branches = (): Record<string, unknown>[] =>
      Array.from({ length: 2 + Math.floor(rng() * 2) }, () => node(depth - 1))
    if (roll < 0.2) return { anyOf: branches() }
    if (roll < 0.3) return { oneOf: branches() }
    if (roll < 0.4) return { allOf: branches() }
    if (roll < 0.5) return { type: 'array', items: node(depth - 1, true) }
    const properties: Record<string, unknown> = {}
    for (const key of ['a', 'b', 'c']) if (rng() < 0.7) properties[key] = node(depth - 1, true)
    const object: Record<string, unknown> = { type: 'object', properties }
    if (rng() < 0.3) object['required'] = ['a']
    if (rng() < 0.2) {
      object['if'] = { properties: { a: { const: pick(rng, [true, 'x', 1]) } }, required: ['a'] }
      object['then'] = { properties: { b: node(depth - 1) } }
      if (rng() < 0.5) object['else'] = { properties: { b: node(depth - 1) } }
    }
    return object
  }
  const schema: Record<string, unknown> = { type: 'object', properties: { d: node(3) } }
  if (withRefs) schema['$defs'] = Object.fromEntries(DEFS.map((key) => [key, node(2)]))
  return schema
}

const fuzz = async (seed: number, withRefs: boolean): Promise<{ accepted: number; problems: string[] }> => {
  const rng = makeRng(seed)
  let accepted = 0
  const problems: string[] = []
  for (let i = 0; i < 60; i++) {
    const schema = randomSchema(rng, withRefs)
    const { coerce, parse } = await build(schema as JSONSchema)
    const values = Array.from({ length: 20 }, (_, j) => {
      const value = { d: randomValue(rng, 3) }
      return j % 2 === 0 ? value : stringifyScalars(value)
    })
    accepted += values.filter((value) => coerce(structuredClone(value)).valid).length
    for (const problem of disagreements(coerce, parse, values)) problems.push(`${JSON.stringify(schema)}\n  ${problem}`)
  }
  return { accepted, problems }
}

describe('parse-vs-coerce', () => {
  it('agrees on a config of unions reached through $ref', async () => {
    const { coerce, parse } = await build({
      type: 'object',
      properties: {
        get: { $ref: '#/$defs/method' },
        upload: {
          allOf: [
            { $ref: '#/$defs/method' },
            { anyOf: [{ type: 'string' }, { type: 'object', properties: { maxBytes: { type: 'integer' } } }] },
          ],
        },
        keyOpt: { anyOf: [{ type: 'string' }, { const: false }] },
        port: { $ref: '#/$defs/port' },
      },
      $defs: {
        method: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { enabled: { type: 'boolean' }, retries: { type: 'integer' } },
              required: ['enabled'],
            },
          ],
        },
        port: { type: 'number' },
      },
    } as JSONSchema)

    const input = {
      get: { enabled: 'true', retries: '3' },
      upload: { enabled: 'false', maxBytes: '10' },
      keyOpt: false,
      port: '-1',
    }

    expect(parse(input)).toEqual({
      get: { enabled: true, retries: 3 },
      upload: { enabled: false, maxBytes: 10 },
      keyOpt: false,
      port: -1,
    })
    expect(disagreements(coerce, parse, [input, { keyOpt: 5 }, { get: 'GET' }, { upload: 7 }])).toEqual([])
  })

  it('agrees wherever coerceX accepts, across random schemas', { timeout: 120_000 }, async () => {
    const { accepted, problems } = await fuzz(0xc0ffee, false)

    // A fuzz that accepted nothing would agree vacuously.
    expect(accepted).toBeGreaterThan(100)
    expect(problems.slice(0, 5)).toEqual([])
  })

  it('agrees across $defs, $ref and recursion', { timeout: 120_000 }, async () => {
    const { accepted, problems } = await fuzz(0xdef5, true)

    expect(accepted).toBeGreaterThan(100)
    expect(problems.slice(0, 5)).toEqual([])
  })

  // The exact half costs output, so it is carried only where the repairing
  // parser needs it. A schema with no combinator has nothing to disagree about.
  it('leaves the parser of a schema without combinators exactly as it was', async () => {
    const { files } = await build({
      type: 'object',
      properties: { n: { type: 'integer' }, inner: { type: 'object', properties: { b: { type: 'boolean' } } } },
    } as JSONSchema)
    const parser = files.find((file) => file.filename === 'root.parse.ts')?.content ?? ''

    expect(parser).toContain('export const parseRoot')
    expect(parser).not.toContain('matchesRoot')
    expect(parser).not.toContain('coerceRootInput')
  })

  it('keeps the repairing parser behind the coercing one out of the barrel', async () => {
    const { files } = await build({
      anyOf: [{ type: 'string' }, { type: 'object', properties: { n: { type: 'number' } } }],
    } as JSONSchema)
    const barrel = files.find((file) => file.filename === 'index.ts')?.content ?? ''

    expect(barrel).toContain('export const parseRoot =')
    expect(barrel).not.toContain('_parseRootRepair')
  })
})
