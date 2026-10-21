import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { generateValidatorFunction } from './generate-validator-function'
import { linkGenerated } from './link-generated.test-utils'

/**
 * An object schema with many optional properties is read by walking the
 * instance's keys (one `for…in` + `switch` filling a local per declared key)
 * instead of naming every declared property, because naming one an object does
 * not have is what costs a document with varied shapes most of its validation
 * time. The checks themselves are untouched, so the contract is that nothing a
 * caller can see changes: the same verdict from all three entry points, and the
 * same errors in the same order. The interpreter is the oracle for the errors —
 * it reports in declared order and has no key walk to get wrong.
 */

type Result = true | { valid: false; errors: unknown[] }
type Validator = (input: unknown) => Result

const linked = async (
  schema: unknown,
): Promise<{ validateRoot: Validator; checkRoot: Validator; isRoot: (input: unknown) => boolean }> => {
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
    isRoot: linkGenerated<(input: unknown) => boolean>(files, 'index', 'isRoot'),
  }
}

/**
 * A result with the one message the two implementations word differently — a
 * `false` subschema, "boolean schema is false" here and "must not be valid" in
 * the interpreter — brought to the interpreter's wording. Nothing else is touched.
 */
const normalized = (result: unknown): string =>
  JSON.stringify(result, (key, value) =>
    key === 'message' && value === 'boolean schema is false' ? 'must not be valid' : value,
  )

/** Every disagreement between the generated entry points and the interpreter for `value`. */
const disagreements = (
  halves: Awaited<ReturnType<typeof linked>>,
  interpreted: (input: unknown) => unknown,
  value: unknown,
): string[] => {
  const out: string[] = []
  const full = halves.validateRoot(value)
  const reference = interpreted(value)
  if (normalized(full) !== normalized(reference)) {
    out.push(
      `validate ${JSON.stringify(value)}\n  generated=${JSON.stringify(full)}\n  interpreter=${JSON.stringify(reference)}`,
    )
  }
  if (halves.isRoot(value) !== (full === true)) out.push(`isRoot disagrees for ${JSON.stringify(value)}`)
  const first = halves.checkRoot(value)
  const expected = full === true ? true : JSON.stringify(full.errors[0])
  const actual = first === true ? true : JSON.stringify(first.errors[0])
  if (expected !== actual) out.push(`checkRoot disagrees for ${JSON.stringify(value)}: ${actual} vs ${expected}`)
  return out
}

const wide = (count: number, extra: Record<string, unknown> = {}) => ({
  type: 'object' as const,
  properties: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`p${i}`, { type: 'string' as const, minLength: 2 }]),
  ),
  ...extra,
})

describe('key dispatch', () => {
  it('walks the keys of an object with many optional properties', () => {
    expect(generateValidatorFunction(wide(8), 'Root')).toContain('switch (_dk0)')
  })

  it('keeps named reads below the threshold, and for properties that are all required', () => {
    expect(generateValidatorFunction(wide(7), 'Root')).not.toContain('switch (')
    const required = Array.from({ length: 12 }, (_, i) => `p${i}`)
    expect(generateValidatorFunction(wide(12, { required }), 'Root')).not.toContain('switch (')
  })

  it('reports in declared order whatever order the instance keys come in', async () => {
    const schema = wide(10, { required: ['p0'] })
    const halves = await linked(schema)
    const result = halves.validateRoot({ p9: 1, p5: 'x', p1: 2 })
    expect(result).not.toBe(true)
    expect((result as { errors: { path: string }[] }).errors.map((error) => error.path)).toEqual([
      '',
      '/p1',
      '/p5',
      '/p9',
    ])
  })

  it('runs the unknown-key sweep only when the walk met an undeclared key', async () => {
    // `p0` declares nothing to check, so it is read by no one — and must still
    // count as declared rather than send the object through the sweep as unknown.
    const schema = wide(10, { additionalProperties: false })
    schema.properties.p0 = {} as never
    const code = generateValidatorFunction(schema, 'Root')
    expect(code).toContain('if (_dx0) {')
    expect(code).toContain('case "p0":')

    const halves = await linked(schema)
    const interpreted = validate(schema as never)
    for (const value of [{ p0: 1, p1: 'ok' }, { p1: 'ok', zz: 1 }, { zz: 1, p2: 'x', yy: 2 }, {}]) {
      expect(disagreements(halves, interpreted, value)).toEqual([])
    }
  })

  it('reads a prototype-member property off the document, not the walk', async () => {
    // A key walk only sees enumerable keys, so `constructor` keeps the
    // own-property read — and with no own `constructor` it is absent, not
    // `Object` from the prototype.
    const schema = wide(10, {
      properties: { ...wide(10).properties, constructor: { type: 'string' as const } },
      additionalProperties: false,
    })
    const halves = await linked(schema)
    const interpreted = validate(schema as never)
    for (const value of [{}, { constructor: 'x' }, { constructor: 1 }, { constructor: 'x', p3: 'y' }]) {
      expect(disagreements(halves, interpreted, value)).toEqual([])
    }
  })

  it('treats an inline object of the same width the same way', async () => {
    const schema = { type: 'object' as const, properties: { inner: wide(9, { additionalProperties: false }) } }
    expect(generateValidatorFunction(schema, 'Root')).toContain('switch (_dk1)')
    const halves = await linked(schema)
    const interpreted = validate(schema as never)
    for (const value of [{ inner: {} }, { inner: { p8: 1, p0: 'a', q: 1 } }, { inner: 'x' }, { inner: { p4: 'ok' } }]) {
      expect(disagreements(halves, interpreted, value)).toEqual([])
    }
  })

  describe('against the interpreter, over random wide schemas', () => {
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

    const LEAVES: readonly unknown[] = [
      { type: 'string', minLength: 2 },
      { type: 'number', minimum: 0 },
      { type: 'integer' },
      { type: 'boolean' },
      { enum: ['a', 'b', 1] },
      { type: 'array', items: { type: 'string' } },
      {},
      false,
    ]
    const VALUES: readonly unknown[] = ['', 'a', 'ab', 0, -1, 1.5, 2, true, null, ['x'], [1], {}]

    const schemaAt = (rng: () => number, depth: number): Record<string, unknown> => {
      const count = 8 + Math.floor(rng() * 6)
      const properties: Record<string, unknown> = {}
      for (let i = 0; i < count; i++) {
        properties[`k${i}`] = depth > 0 && rng() < 0.15 ? schemaAt(rng, depth - 1) : pick(rng, LEAVES)
      }
      if (rng() < 0.2) properties['toString'] = { type: 'string' }
      const required = Object.keys(properties).filter(() => rng() < 0.15)
      const schema: Record<string, unknown> = { type: 'object', properties }
      if (required.length > 0) schema['required'] = required
      // One or the other, not both: with both, the generator reports the pattern
      // errors before the additional-property ones and the interpreter interleaves
      // them key by key. That predates the key walk and has nothing to do with it.
      const objectKeywords = rng()
      if (objectKeywords < 0.5) schema['additionalProperties'] = false
      else if (objectKeywords < 0.75) schema['patternProperties'] = { '^x-': { type: 'string' } }
      return schema
    }

    const valueFor = (rng: () => number, schema: Record<string, unknown>, depth: number): unknown => {
      const keys = [...Object.keys(schema['properties'] as object), 'x-a', 'extra', 'toString']
      const out: Record<string, unknown> = {}
      const n = Math.floor(rng() * 6)
      for (let i = 0; i < n; i++) {
        const key = pick(rng, keys)
        const sub = (schema['properties'] as Record<string, unknown>)[key]
        out[key] =
          depth > 0 && typeof sub === 'object' && sub !== null && 'properties' in sub && rng() < 0.7
            ? valueFor(rng, sub as Record<string, unknown>, depth - 1)
            : pick(rng, VALUES)
      }
      // Through JSON so a `toString` key is an own data property, as it would be in a parsed document.
      return JSON.parse(JSON.stringify(out))
    }

    it('agrees on every verdict and every error', { timeout: 120_000 }, async () => {
      const failures: string[] = []
      for (let seed = 1; seed <= 60; seed++) {
        const rng = makeRng(seed)
        const schema = schemaAt(rng, 2)
        const halves = await linked(schema)
        const interpreted = validate(schema as never)
        for (let i = 0; i < 25; i++) failures.push(...disagreements(halves, interpreted, valueFor(rng, schema, 2)))
      }
      expect(failures.slice(0, 5), failures.slice(0, 5).join('\n\n')).toEqual([])
    })
  })
})
