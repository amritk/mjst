import { validate } from '@amritk/runtime-validators'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { linkGenerated } from './link-generated.test-utils'

/**
 * Differential fuzz over the *whole* generated set: schemas are built, linked,
 * and run, and the verdict has to match both oracles — the runtime interpreter
 * and Ajv — with `isX` agreeing with `validateX` on every value.
 *
 * `differential.test.ts` fuzzes one emitted function against Ajv; this one adds
 * the axes that only show up once a schema is more than one file and more than
 * one keyword family:
 *
 *   - a `$ref` into `$defs`, so the import list, the emitted call, and the linked
 *     module all have to line up;
 *   - keys a real document really does carry and a code generator can trip over —
 *     `__proto__`, `constructor`, `a/b`, `a~b`, a non-ASCII name;
 *   - the keywords `differential.test.ts` deliberately leaves alone: combinators,
 *     tuples, `contains`, `dependentSchemas`, `propertyNames`, `uniqueItems`.
 *
 * Ajv referees everything except a schema naming an `Object.prototype` member: it
 * reads inherited members, so for those it disagrees with the spec and with the
 * interpreter (see `prototype-safety.test.ts`). The interpreter referees those.
 *
 * A seed is a whole schema, so a failure prints the schema and the value and
 * reproduces on its own.
 */

// mulberry32 — the same deterministic PRNG `differential.test.ts` uses.
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

/** Keys chosen to hit the prototype-member path, the pointer escapes, and non-ASCII naming. */
const KEYS = ['a', 'b', '__proto__', 'constructor', 'toString', 'x-ext', 'a/b', 'a~b', 'é', '0'] as const
const SCALARS: readonly unknown[] = ['', 'ab', 'abc', 0, 1, -1, 1.5, true, false, null]

const leafSchema = (rng: () => number): unknown => {
  switch (pick(rng, ['string', 'number', 'integer', 'boolean', 'null', 'enum', 'const', 'true', 'false', 'ref'])) {
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
    case 'false':
      return false
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

/**
 * A JSON value: round-tripped, so nothing here depends on a shape `JSON.parse`
 * cannot produce.
 *
 * Arrays are built from a two-element pool rather than independently, so
 * duplicates and near-duplicates are common — an array of freshly random
 * elements is almost never a `uniqueItems` violation, and a fuzz that never
 * produces one cannot notice a `uniqueItems` check going missing.
 */
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

/** Ajv reads inherited members, so it cannot referee a schema that names one. */
const PROTOTYPE_MEMBER_KEY = /"(?:toString|constructor|__proto__|hasOwnProperty|valueOf|isPrototypeOf)"/

/**
 * Ajv's verdict function for a schema, or `null` when Ajv is not a referee for
 * it: it reads inherited members, and it also declines to compile a few shapes
 * the fuzzer builds (a `properties` map whose key happens to be a keyword name
 * reads to its metaschema check as a malformed keyword). The interpreter judges
 * those alone, which is the same split `prototype-safety.test.ts` makes.
 */
const ajvRefereeFor = (ajv: Ajv2020, schema: Record<string, unknown>): ((value: unknown) => boolean) | null => {
  if (PROTOTYPE_MEMBER_KEY.test(JSON.stringify(schema))) return null
  try {
    return ajv.compile(schema as never)
  } catch {
    return null
  }
}

const SEEDS = 300
const VALUES_PER_SEED = 12

describe('linked-differential', () => {
  it('agrees with the interpreter and Ajv across randomly generated linked schemas', { timeout: 60_000 }, async () => {
    const ajv = new Ajv2020({ strict: false })
    const failures: string[] = []
    let checked = 0
    let refused = 0

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = makeRng(seed)
      const schema = {
        ...(schemaAt(rng, 3) as object),
        $defs: { leaf: { type: 'string', minLength: 2 } },
      } as Record<string, unknown>

      const files = await buildValidatorSchema(schema as never, 'Root', '')
      const validateRoot = linkGenerated<(input: unknown) => unknown>(files, 'index', 'validateRoot')
      const isRoot = linkGenerated<(input: unknown) => boolean>(files, 'index', 'isRoot')
      const interpreted = validate(schema as never)
      const ajvValidate = ajvRefereeFor(ajv, schema)
      if (ajvValidate === null) refused++

      for (let i = 0; i < VALUES_PER_SEED; i++) {
        const value = valueAt(rng, 3)
        checked++
        const generated = validateRoot(value) === true
        const expected = interpreted(value) === true
        const guard = isRoot(value)
        const byAjv = ajvValidate ? ajvValidate(value) : expected
        if (generated === expected && guard === generated && byAjv === expected) continue
        failures.push(
          `seed ${seed}: generated=${generated} guard=${guard} interpreter=${expected} ajv=${byAjv}\n` +
            `  schema=${JSON.stringify(schema)}\n  value=${JSON.stringify(value)}`,
        )
        break
      }
    }

    expect(checked).toBeGreaterThan(SEEDS * VALUES_PER_SEED - 1)
    // Ajv referees most seeds; if it stopped refereeing most of them the fuzzer
    // has drifted into shapes it will not compile and half the oracle is gone.
    expect(refused, 'Ajv refused too many of the generated schemas to referee them').toBeLessThan(SEEDS / 4)
    expect(failures, failures.join('\n')).toEqual([])
  })
})
