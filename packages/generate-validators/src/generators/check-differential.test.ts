import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { linkGenerated } from './link-generated.test-utils'

/**
 * The contract of the fail-fast half, asserted differentially against the half
 * it has to agree with.
 *
 * `checkX` is not a second opinion about a document — it is `validateX` stopped
 * early, so two things have to hold for every schema and every value:
 *
 *   - it says `true` exactly when `validateX` says `true`. This is the property
 *     that catches a `return` escaping the wrong function: a report emitted
 *     inside a combinator's match IIFE would leave the *branch*, not the
 *     validator, and the verdict would silently flip;
 *   - when it does not, it carries exactly one error, and that error is the one
 *     `validateX` reported first. Callers share their error handling between the
 *     two, so a different path, keyword or message is a difference they would
 *     have to know about.
 *
 * Both a fixed corpus of shapes (every construct with an emitter of its own) and
 * a fuzz over randomly generated schemas, because the two find different things:
 * the corpus pins the shapes that matter, the fuzz finds the combinations nobody
 * thought to write down.
 */

// mulberry32 — the same deterministic PRNG the other differential suites use.
const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T

/** What a generated validator (either half) answers with. */
type Result = true | { valid: false; errors: { message: string; path: string; keyword: string }[] }
type Validator = (input: unknown, path?: string) => Result

const LEAF = { type: 'string', minLength: 2 } as const

/**
 * One case per construct that has an emitter of its own, each paired with values
 * that pass, values that fail in one place, and values that fail in several — a
 * value with a single failure cannot tell "the first error" apart from "an
 * error", which is the whole thing under test.
 */
const CASES: ReadonlyArray<readonly [string, unknown, readonly unknown[]]> = [
  [
    'scalar root',
    { type: 'string', minLength: 2, maxLength: 4, pattern: '^a' },
    ['ab', 'a', '', 'zzz', 'abcde', 42, null, undefined, []],
  ],
  ['boolean root', { type: 'boolean' }, [true, false, 'x', 0, null]],
  ['multi-type root', { type: ['string', 'null'], minLength: 2 }, ['ab', 'a', null, 3, {}]],
  [
    'required and nested objects',
    {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 2 },
        inner: {
          type: 'object',
          properties: { a: { type: 'number', minimum: 1 }, b: { type: 'string' } },
          required: ['a'],
        },
      },
      required: ['id', 'inner'],
    },
    [
      { id: 'ab', inner: { a: 1 } },
      {},
      { id: 'a', inner: {} },
      { id: 1, inner: { a: 0, b: 2 } },
      { id: 'ab', inner: 'nope' },
    ],
  ],
  [
    'arrays of objects',
    {
      type: 'array',
      minItems: 1,
      items: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
    },
    [[{ n: 1 }], [], [{}, {}], [{ n: 'x' }, { n: 1.5 }], 'not an array', [1, 2]],
  ],
  [
    'additionalProperties false',
    { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
    [{ a: 'x' }, { a: 'x', b: 1 }, { b: 1, c: 2 }, { a: 3, b: 1 }],
  ],
  [
    'patternProperties',
    { type: 'object', patternProperties: { '^x-': { type: 'number' } }, properties: { a: { type: 'string' } } },
    [{ 'x-1': 1 }, { 'x-1': 'no', 'x-2': 'no' }, { a: 1, 'x-1': 'no' }],
  ],
  [
    'tuples and prefixItems',
    { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false },
    [['a', 1], [1, 'a'], ['a'], ['a', 1, 2], [1, 'a', 3]],
  ],
  [
    'anyOf',
    { type: 'object', properties: { u: { anyOf: [{ type: 'string', minLength: 3 }, { type: 'number' }] } } },
    [{ u: 'abc' }, { u: 1 }, { u: 'ab' }, { u: true }, { u: {} }],
  ],
  ['oneOf', { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }] }, ['a', 1, true, null, 1.5]],
  [
    'oneOf beside a sibling type',
    { type: 'object', properties: { k: { type: 'string' } }, oneOf: [{ required: ['k'] }, { required: ['j'] }] },
    [{ k: 'a' }, {}, { k: 1 }, { k: 'a', j: 1 }],
  ],
  [
    'not and if/then/else',
    {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] }, value: { type: 'integer' } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['value'] },
      else: { required: ['kind'] },
      not: { required: ['forbidden'] },
    },
    [{ kind: 'a', value: 1 }, { kind: 'a' }, {}, { kind: 'c', forbidden: 1 }, { kind: 'a', value: 'x', forbidden: 1 }],
  ],
  [
    '$ref across files',
    {
      type: 'object',
      properties: { one: { $ref: '#/$defs/leaf' }, two: { $ref: '#/$defs/holder' } },
      required: ['one', 'two'],
      $defs: {
        leaf: LEAF,
        holder: { type: 'object', properties: { deep: { $ref: '#/$defs/leaf' } }, required: ['deep'] },
      },
    },
    [
      { one: 'ab', two: { deep: 'cd' } },
      {},
      { one: 'a', two: { deep: 'b' } },
      { one: 1, two: {} },
      { one: 'ab', two: { deep: 1 } },
    ],
  ],
  [
    '$ref inside a combinator',
    { anyOf: [{ $ref: '#/$defs/leaf' }, { type: 'number' }], $defs: { leaf: LEAF } },
    ['ab', 1, 'a', true],
  ],
  [
    'contains and uniqueItems',
    { type: 'array', contains: { type: 'number' }, minContains: 2, uniqueItems: true, maxItems: 4 },
    [[1, 2], ['a'], [1, 1], [1, 2, 3, 4, 5], []],
  ],
  [
    'dependent keywords',
    {
      type: 'object',
      properties: { a: { type: 'string' } },
      dependentRequired: { a: ['b'] },
      dependentSchemas: { b: { required: ['c'] } },
      minProperties: 1,
      propertyNames: { maxLength: 3 },
    },
    [{ a: 'x', b: 1, c: 1 }, {}, { a: 'x' }, { a: 'x', b: 1 }, { loooong: 1 }],
  ],
  [
    'unevaluatedProperties',
    {
      properties: { foo: { type: 'string' } },
      allOf: [{ properties: { bar: { type: 'boolean' } } }],
      unevaluatedProperties: false,
    },
    [{ foo: 'a' }, { foo: 'a', nope: 1 }, { foo: 1, nope: 1 }, { bar: true }],
  ],
  // The shapes that cannot short-circuit and fall back to `validateX`: an
  // unsatisfiable position reports with no runtime condition in front of it. The
  // contract is the same either way, which is what these pin.
  [
    'a false subschema in a present position',
    { type: 'object', properties: { a: { allOf: [false] }, b: { type: 'string' } }, required: ['a'] },
    [{ a: 1, b: 2 }, {}, { a: 1, b: 'x' }],
  ],
  [
    'an always-matching not',
    { type: 'object', properties: { a: { not: {} }, b: { type: 'string' } }, required: ['a'] },
    [{ a: 1, b: 2 }, {}, { b: 'x' }],
  ],
]

/** Keys chosen to hit the prototype-member path, the pointer escapes, and non-ASCII naming. */
const KEYS = ['a', 'b', '__proto__', 'constructor', 'toString', 'x-ext', 'a/b', 'a~b', 'é', '0'] as const
const SCALARS: readonly unknown[] = ['', 'ab', 'abc', 0, 1, -1, 1.5, true, false, null]

const leafSchema = (rng: () => number): unknown => {
  switch (pick(rng, ['string', 'number', 'integer', 'boolean', 'null', 'enum', 'const', 'true', 'ref'])) {
    case 'string':
      return rng() < 0.5 ? { type: 'string' } : { type: 'string', minLength: 1, maxLength: 3 }
    case 'number':
      return rng() < 0.5 ? { type: 'number' } : { type: 'number', minimum: 0, maximum: 10 }
    case 'integer':
      return { type: 'integer', multipleOf: 2 }
    case 'boolean':
      return { type: 'boolean' }
    case 'null':
      return { type: 'null' }
    case 'enum':
      return { enum: [pick(rng, SCALARS), pick(rng, SCALARS)] }
    case 'const':
      return { const: pick(rng, SCALARS) }
    case 'true':
      return true
    default:
      return { $ref: '#/$defs/leaf' }
  }
}

const schemaAt = (rng: () => number, depth: number): unknown => {
  if (depth <= 0) return leafSchema(rng)
  switch (pick(rng, ['object', 'array', 'tuple', 'contains', 'combinator', 'deps', 'typeless', 'leaf'])) {
    case 'object': {
      const properties: Record<string, unknown> = {}
      for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) properties[pick(rng, KEYS)] = schemaAt(rng, depth - 1)
      const schema: Record<string, unknown> = { type: 'object', properties }
      if (rng() < 0.5) schema['required'] = [pick(rng, Object.keys(properties))]
      if (rng() < 0.3) schema['additionalProperties'] = rng() < 0.5 ? false : schemaAt(rng, depth - 1)
      if (rng() < 0.3) schema['patternProperties'] = { '^x-': schemaAt(rng, depth - 1) }
      if (rng() < 0.2) schema['propertyNames'] = { maxLength: 3 }
      if (rng() < 0.2) schema['minProperties'] = 1
      return schema
    }
    case 'array': {
      const schema: Record<string, unknown> = { type: 'array', items: schemaAt(rng, depth - 1) }
      if (rng() < 0.4) schema['minItems'] = 1
      if (rng() < 0.3) schema['uniqueItems'] = true
      return schema
    }
    case 'tuple': {
      const schema: Record<string, unknown> = {
        type: 'array',
        prefixItems: [schemaAt(rng, depth - 1), { type: 'string' }],
      }
      if (rng() < 0.5) schema['items'] = rng() < 0.5 ? false : { type: 'number' }
      return schema
    }
    case 'contains':
      return { type: 'array', contains: schemaAt(rng, depth - 1), ...(rng() < 0.5 ? { minContains: 2 } : {}) }
    case 'combinator': {
      const which = pick(rng, ['allOf', 'anyOf', 'oneOf', 'not', 'if'] as const)
      if (which === 'not') return { not: schemaAt(rng, depth - 1) }
      if (which === 'if') {
        return { if: schemaAt(rng, depth - 1), then: schemaAt(rng, depth - 1), else: schemaAt(rng, depth - 1) }
      }
      return { [which]: [schemaAt(rng, depth - 1), schemaAt(rng, depth - 1)] }
    }
    case 'deps':
      return { type: 'object', dependentRequired: { a: ['b'] }, dependentSchemas: { b: schemaAt(rng, depth - 1) } }
    case 'typeless':
      return pick(rng, [{ minLength: 2 }, { minItems: 2 }, { required: ['a'] }, { minimum: 3 }, {}])
    default:
      return leafSchema(rng)
  }
}

const valueAt = (rng: () => number, depth: number): unknown => {
  const p = rng()
  if (depth <= 0 || p < 0.45) return pick(rng, SCALARS)
  if (p < 0.65) {
    const pool = [valueAt(rng, depth - 1), valueAt(rng, depth - 1)]
    return Array.from({ length: Math.floor(rng() * 5) }, () => pick(rng, pool))
  }
  const out: Record<string, unknown> = {}
  for (let i = 0; i < Math.floor(rng() * 4); i++) out[pick(rng, KEYS)] = valueAt(rng, depth - 1)
  return JSON.parse(JSON.stringify(out))
}

/** Builds both halves of one schema, linked as the set they ship as. */
const halves = async (schema: unknown): Promise<{ validateRoot: Validator; checkRoot: Validator }> => {
  const files = await buildValidatorSchema(
    schema as never,
    'Root',
    '',
    undefined,
    undefined,
    undefined,
    false,
    false,
    false,
    'js',
    true,
  )
  return {
    validateRoot: linkGenerated<Validator>(files, 'index', 'validateRoot'),
    checkRoot: linkGenerated<Validator>(files, 'index', 'checkRoot'),
  }
}

/** The disagreement between the two halves for one value, or `null` when there is none. */
const disagreement = (validateRoot: Validator, checkRoot: Validator, value: unknown): string | null => {
  const full = validateRoot(value)
  const first = checkRoot(value)
  if ((full === true) !== (first === true)) {
    return `validate=${full === true} check=${first === true} for ${JSON.stringify(value)}`
  }
  if (full === true || first === true) return null
  if (first.errors.length !== 1) {
    return `check returned ${first.errors.length} errors for ${JSON.stringify(value)}: ${JSON.stringify(first.errors)}`
  }
  const expected = JSON.stringify(full.errors[0])
  const actual = JSON.stringify(first.errors[0])
  if (expected !== actual)
    return `first error differs for ${JSON.stringify(value)}\n  validate=${expected}\n  check=${actual}`
  return null
}

const SEEDS = 200
const VALUES_PER_SEED = 12

describe('check-differential', () => {
  it.each(CASES)('answers as validateX does, with only its first error: %s', async (_label, schema, values) => {
    const { validateRoot, checkRoot } = await halves(schema)

    const failures = values.map((value) => disagreement(validateRoot, checkRoot, value)).filter((f) => f !== null)

    expect(failures, failures.join('\n')).toEqual([])
  })

  it('agrees with validateX across randomly generated linked schemas', { timeout: 120_000 }, async () => {
    const failures: string[] = []
    let checked = 0

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = makeRng(seed)
      const schema = { ...(schemaAt(rng, 3) as object), $defs: { leaf: LEAF } }
      const { validateRoot, checkRoot } = await halves(schema)

      for (let i = 0; i < VALUES_PER_SEED; i++) {
        const value = valueAt(rng, 3)
        checked++
        const failure = disagreement(validateRoot, checkRoot, value)
        if (failure === null) continue
        failures.push(`seed ${seed}: ${failure}\n  schema=${JSON.stringify(schema)}`)
        break
      }
    }

    expect(checked).toBeGreaterThan(SEEDS * VALUES_PER_SEED - 1)
    expect(failures, failures.join('\n')).toEqual([])
  })
})
