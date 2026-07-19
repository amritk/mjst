import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { evalGenerated, generateFileParser, KEYS, makeRng, pick } from './differential.test-utils'

/**
 * Differential fuzz for the *strict* parser modes, with Ajv as the oracle.
 * The lax fuzzer (parser-conformance.differential.test.ts) checks coercion;
 * this one checks the accept/reject contract that the fast-path machinery —
 * deep guards, the own-key-count no-extras form, `_every` item loops, and the
 * clean-value reference returns — must never distort:
 *
 *   - strict:            parse(input) throws  ⇔  Ajv rejects input,
 *                        and an accepted value deep-equals the input.
 *   - strict + stripUnknown (open schemas only): parse(input) throws ⇔ Ajv
 *                        rejects the *stripped* input, and an accepted value
 *                        deep-equals that stripped input.
 *
 * The schema vocabulary is restricted to what strict mode fully enforces
 * (scalar types, enums, required, additionalProperties: false, nested objects,
 * arrays of scalar/enum/object items) so the oracle is exact in both
 * directions. Inputs are built valid from the schema and then randomly
 * mutated (extra keys, wrong types, dropped required keys, non-member enum
 * values, bad array elements) so both branches get dense coverage.
 */

type Rng = () => number
type SchemaNode = Record<string, unknown>

const leaf = (rng: Rng): SchemaNode => {
  const k = rng()
  if (k < 0.15) return { type: 'string', enum: ['a', 'b', 'c'] }
  if (k < 0.3) return { type: 'number', enum: [1, 2, 3] }
  if (k < 0.4) return { enum: ['x', 'y'] }
  return { type: pick(rng, ['string', 'number', 'integer', 'boolean', 'null']) }
}

/**
 * A random object schema. `closedAllowed` gates `additionalProperties: false`
 * (the strip fuzz keeps schemas open so stripping is never a rejection), and
 * the required set is sometimes exactly the declared keys — the shape that
 * turns the no-extras guard into the own-key-count form — and sometimes a
 * subset, which keeps the per-key walk form covered too.
 */
const genObject = (rng: Rng, depth: number, closedAllowed: boolean): SchemaNode => {
  const properties: Record<string, SchemaNode> = {}
  const declared: string[] = []
  const n = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const key = pick(rng, KEYS)
    if (key in properties) continue
    properties[key] = genValue(rng, depth - 1, closedAllowed)
    declared.push(key)
  }
  const allRequired = rng() < 0.5
  const required = allRequired ? declared : declared.filter(() => rng() < 0.6)
  const schema: SchemaNode = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required
  if (closedAllowed && rng() < 0.5) schema['additionalProperties'] = false
  return schema
}

const genValue = (rng: Rng, depth: number, closedAllowed: boolean): SchemaNode => {
  if (depth <= 0) return leaf(rng)
  const k = rng()
  if (k < 0.35) return genObject(rng, depth, closedAllowed)
  if (k < 0.55) {
    const itemKind = rng()
    const items =
      itemKind < 0.5 ? genObject(rng, depth - 1, closedAllowed) : itemKind < 0.75 ? leaf(rng) : { type: 'string' }
    return { type: 'array', items }
  }
  return leaf(rng)
}

/** Builds a valid instance of `schema`. */
const buildValid = (rng: Rng, schema: SchemaNode): unknown => {
  if ('enum' in schema) return pick(rng, schema['enum'] as unknown[])
  const type = schema['type']
  if (type === 'object') {
    const out: Record<string, unknown> = {}
    const properties = (schema['properties'] ?? {}) as Record<string, SchemaNode>
    const required = new Set((schema['required'] as string[] | undefined) ?? [])
    for (const key of Object.keys(properties)) {
      if (required.has(key) || rng() < 0.5) out[key] = buildValid(rng, properties[key] as SchemaNode)
    }
    return out
  }
  if (type === 'array') {
    const items = schema['items'] as SchemaNode
    return Array.from({ length: Math.floor(rng() * 3) }, () => buildValid(rng, items))
  }
  switch (type) {
    case 'string':
      return pick(rng, ['', 'v', 'hello'])
    case 'number':
      return pick(rng, [0, 1.5, -7])
    case 'integer':
      return pick(rng, [0, 2, -3])
    case 'boolean':
      return rng() < 0.5
    case 'null':
      return null
    default:
      return null
  }
}

/** Collects every object node (with its schema) reachable in `value`. */
const objectNodes = (value: unknown, schema: SchemaNode, out: [Record<string, unknown>, SchemaNode][]): void => {
  if ('enum' in schema) return
  if (schema['type'] === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    out.push([value as Record<string, unknown>, schema])
    const properties = (schema['properties'] ?? {}) as Record<string, SchemaNode>
    for (const key of Object.keys(properties)) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) objectNodes(v, properties[key] as SchemaNode, out)
    }
    return
  }
  if (schema['type'] === 'array' && Array.isArray(value)) {
    for (const element of value) objectNodes(element, schema['items'] as SchemaNode, out)
  }
}

/** Applies 0-2 random mutations somewhere in the (cloned) value. */
const mutate = (rng: Rng, value: unknown, schema: SchemaNode): unknown => {
  const clone = structuredClone(value)
  const mutations = Math.floor(rng() * 3)
  for (let m = 0; m < mutations; m++) {
    const nodes: [Record<string, unknown>, SchemaNode][] = []
    objectNodes(clone, schema, nodes)
    if (nodes.length === 0) break
    const [node, nodeSchema] = pick(rng, nodes)
    const properties = (nodeSchema['properties'] ?? {}) as Record<string, SchemaNode>
    const declared = Object.keys(properties)
    const kind = rng()
    if (kind < 0.35) {
      node['zz'] = pick(rng, ['extra', 42, true])
    } else if (kind < 0.6 && declared.length > 0) {
      node[pick(rng, declared)] = pick(rng, ['nope', 13.37, false, null, {}])
    } else if (kind < 0.8) {
      const present = declared.filter((key) => key in node)
      if (present.length > 0) delete node[pick(rng, present)]
    } else if (declared.length > 0) {
      const key = pick(rng, declared)
      const propSchema = properties[key] as SchemaNode
      if (propSchema['type'] === 'array' && key in node && Array.isArray(node[key])) {
        ;(node[key] as unknown[]).push(pick(rng, ['bad', 99, { zz: 1 }]))
      } else {
        node['zz2'] = 'extra'
      }
    }
  }
  return clone
}

/**
 * The stripUnknown oracle: rebuilds `value` keeping only declared properties,
 * recursively — through nested objects and object array items — mirroring the
 * strip parser's contract. Non-object schemas pass values through.
 */
const stripByShape = (value: unknown, schema: SchemaNode): unknown => {
  if ('enum' in schema) return value
  if (schema['type'] === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = (schema['properties'] ?? {}) as Record<string, SchemaNode>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(properties)) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = stripByShape(v, properties[key] as SchemaNode)
    }
    return out
  }
  if (schema['type'] === 'array' && Array.isArray(value)) {
    return value.map((element) => stripByShape(element, schema['items'] as SchemaNode))
  }
  return value
}

const deepEquals = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b)

describe('strict parser conformance vs ajv', () => {
  it('strict mode throws exactly when ajv rejects, and returns the value unchanged', { timeout: 60_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x57121c7)
    const failures: string[] = []

    for (let i = 0; i < 700 && failures.length < 8; i++) {
      const schema = genObject(rng, 3, true)
      let check: (v: unknown) => boolean
      try {
        check = ajv.compile(schema)
      } catch {
        continue
      }
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateFileParser(schema as never, 'Root', { strict: true }),
        'parseRoot',
      )

      for (let t = 0; t < 8 && failures.length < 8; t++) {
        const input = mutate(rng, buildValid(rng, schema), schema)
        const valid = check(input)
        let output: unknown
        let threw = false
        try {
          output = parse(structuredClone(input))
        } catch {
          threw = true
        }
        if (threw === valid) {
          failures.push(
            `strict ${threw ? 'rejected a valid' : 'accepted an invalid'} value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}`,
          )
        } else if (!threw && !deepEquals(output, input)) {
          failures.push(
            `strict changed an accepted value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  output: ${JSON.stringify(output)}`,
          )
        }
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([])
  })

  it('strict + stripUnknown throws exactly when ajv rejects the stripped value', { timeout: 60_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x5717b0)
    const failures: string[] = []

    for (let i = 0; i < 700 && failures.length < 8; i++) {
      // Open schemas only: with additionalProperties: false, rejecting wins
      // over stripping, which the plain-strict fuzz above already covers.
      const schema = genObject(rng, 3, false)
      let check: (v: unknown) => boolean
      try {
        check = ajv.compile(schema)
      } catch {
        continue
      }
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateFileParser(schema as never, 'Root', { strict: true, stripUnknown: true }),
        'parseRoot',
      )

      for (let t = 0; t < 8 && failures.length < 8; t++) {
        const input = mutate(rng, buildValid(rng, schema), schema)
        const stripped = stripByShape(input, schema)
        const valid = check(stripped)
        let output: unknown
        let threw = false
        try {
          output = parse(structuredClone(input))
        } catch {
          threw = true
        }
        if (threw === valid) {
          failures.push(
            `strip ${threw ? 'rejected a valid' : 'accepted an invalid'} value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  stripped: ${JSON.stringify(stripped)}`,
          )
        } else if (!threw && !deepEquals(output, stripped)) {
          failures.push(
            `strip returned the wrong value\n  schema: ${JSON.stringify(schema)}\n  input: ${JSON.stringify(input)}\n  expected: ${JSON.stringify(stripped)}\n  output: ${JSON.stringify(output)}`,
          )
        }
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([])
  })
})
