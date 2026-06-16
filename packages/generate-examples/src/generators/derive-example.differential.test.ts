import Ajv from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

import { deriveExample } from './derive-example'

/**
 * The package's promise is that `deriveExample` returns a *valid instance* of the
 * schema. This fuzzes satisfiable schemas (built so a valid value always exists)
 * across the keyword subset the deriver supports — string/number/integer bounds
 * and `multipleOf`, objects with `required` (including keys with no `properties`
 * entry), arrays with `items`/tuple `prefixItems` and `minItems`/`maxItems`,
 * `allOf`, `enum`/`const` — and asserts the derived example validates with Ajv.
 *
 * Keywords the deriver does not promise to satisfy (`pattern`, `uniqueItems`,
 * `contains`, `minProperties`, overlapping `oneOf`) are left out so a failure
 * here always means a real regression, not an impossible schema.
 */

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

/** A satisfiable scalar leaf: numeric bounds are always consistent. */
const leaf = (rng: () => number): Record<string, unknown> => {
  const type = pick(rng, ['string', 'integer', 'number', 'boolean', 'null'])
  const s: Record<string, unknown> = { type }
  if (type === 'string') {
    if (rng() < 0.4) s['minLength'] = Math.floor(rng() * 4)
    if (rng() < 0.4) s['maxLength'] = 6 + Math.floor(rng() * 6)
    if (rng() < 0.3) s['enum'] = ['aa', 'bbb', 'cccc']
  } else if (type === 'integer' || type === 'number') {
    const min = pick(rng, [0, 1, 4, 7])
    if (rng() < 0.6) s['minimum'] = min
    if (rng() < 0.5) s['maximum'] = min + pick(rng, [10, 20, 40])
    if (rng() < 0.3) s['exclusiveMinimum'] = min - 1
    if (rng() < 0.4) s['multipleOf'] = pick(rng, [1, 2, 5])
  }
  return s
}

const gen = (rng: () => number, depth: number): Record<string, unknown> => {
  if (depth <= 0) return leaf(rng)
  const k = rng()

  // `allOf` of object branches with DISJOINT property keys — always satisfiable,
  // and exercises property + required merging across branches.
  if (k < 0.2) {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f']
    let next = 0
    const branchCount = 1 + Math.floor(rng() * 3)
    const allOf = Array.from({ length: branchCount }, () => {
      const key = keys[next++] as string
      return { type: 'object', properties: { [key]: leaf(rng) }, required: [key] }
    })
    return { allOf }
  }

  if (k < 0.45) {
    const s: Record<string, unknown> = { type: 'object' }
    const props: Record<string, unknown> = {}
    const n = Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) props[pick(rng, ['a', 'b', 'c', 'd'])] = gen(rng, depth - 1)
    s['properties'] = props
    if (rng() < 0.5) {
      const req = Object.keys(props)
      // Sometimes require a key with no `properties` entry.
      if (rng() < 0.3) req.push('extra')
      s['required'] = req
      if (req.includes('extra')) s['additionalProperties'] = leaf(rng)
    }
    return s
  }

  if (k < 0.7) {
    const s: Record<string, unknown> = { type: 'array' }
    if (rng() < 0.4) {
      s['prefixItems'] = [leaf(rng), leaf(rng)]
      if (rng() < 0.5) s['items'] = leaf(rng)
    } else {
      s['items'] = gen(rng, depth - 1)
    }
    const min = Math.floor(rng() * 3)
    if (rng() < 0.6) s['minItems'] = min
    if (rng() < 0.6) s['maxItems'] = min + 2 + Math.floor(rng() * 3) // always >= minItems
    return s
  }

  if (k < 0.85) return { enum: [{ x: 1 }, 'str', 42] }
  return leaf(rng)
}

describe('deriveExample is a valid instance (differential vs ajv)', () => {
  it('agrees with ajv across satisfiable schemas', { timeout: 60_000 }, () => {
    const ajv = new Ajv({ strict: false, allErrors: false })
    const rng = makeRng(0x9a17)
    const failures: string[] = []

    for (let i = 0; i < 3000 && failures.length < 8; i++) {
      const schema = gen(rng, 3)
      let check: (v: unknown) => boolean
      try {
        check = ajv.compile(schema)
      } catch {
        continue
      }
      const example = deriveExample(schema as never)
      if (check(example) !== true) {
        failures.push(`schema: ${JSON.stringify(schema)}\n  example: ${JSON.stringify(example)}`)
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([])
  })
})
