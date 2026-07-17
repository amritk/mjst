import { describe, expect, it } from 'vitest'

import { buildQueryObject } from './build-query-object'
import { buildQueryObjectFromString } from './build-query-object-from-string'
import type { Coercion } from './types'

const PLANS: ReadonlyArray<ReadonlyMap<string, Coercion>> = [
  new Map(),
  new Map<string, Coercion>([
    ['limit', 'number'],
    ['verbose', 'boolean'],
    ['tags', 'string-array'],
    ['ids', 'number-array'],
    ['flags', 'boolean-array'],
  ]),
]

/**
 * The fast parser is only correct if it is indistinguishable from
 * URLSearchParams — that is the whole contract — so every case asserts
 * equality with the reference implementation rather than a hand-written
 * expectation.
 */
const CASES: readonly string[] = [
  '',
  '?',
  'limit=5',
  '?limit=5&verbose=true',
  'tags=a&tags=b&tags=c',
  'ids=1&ids=2',
  'flags=true&flags=false',
  'limit=not-a-number',
  'verbose=yes',
  // Structural oddities URLSearchParams has defined answers for.
  'flag',
  'flag&limit=2',
  'a=',
  '=b',
  '=',
  'a=1&&b=2',
  '&&&',
  'a=1&a=2',
  'a==b',
  'a=b=c',
  // Encoded inputs must take the URLSearchParams fallback.
  'name=Ada%20Lovelace',
  'q=a+b',
  'q=%E2%9C%93',
  'bad=%zz',
  'tags=a%2Cb&tags=c',
  '%6c%69%6d%69%74=5',
]

describe('build-query-object-from-string', () => {
  it('keeps __proto__ as an own property on both the fast path and the fallback', () => {
    // Plain string takes the hand-rolled parser; the encoded variant falls
    // back to URLSearchParams — both must land the key as ordinary data.
    for (const source of ['__proto__=evil', '__proto%5F%5F=x&__proto__=evil']) {
      const query = buildQueryObjectFromString(source, new Map())
      expect(Object.getPrototypeOf(query)).toBe(null)
      expect(query['__proto__']).toBe('evil')
      expect(({} as Record<string, unknown>)['evil']).toBeUndefined()
    }
  })

  it('matches URLSearchParams on every case and plan', () => {
    for (const plan of PLANS) {
      for (const queryString of CASES) {
        const fast = buildQueryObjectFromString(queryString, plan)
        const reference = buildQueryObject(new URLSearchParams(queryString), plan)
        expect(fast, `'${queryString}' with ${plan.size} coercions`).toEqual(reference)
      }
    }
  })

  it('matches URLSearchParams on randomized plain query strings', () => {
    // Deterministic pseudo-random corpus: covers key/value/separator
    // permutations the hand-written cases might miss.
    const alphabet = ['a', 'b', 'limit', 'tags', '=', '&', '1', 'true', '']
    let seed = 42
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let round = 0; round < 200; round++) {
      const pieces: string[] = []
      const count = next() % 12
      for (let i = 0; i < count; i++) pieces.push(alphabet[next() % alphabet.length] as string)
      const queryString = pieces.join('')
      for (const plan of PLANS) {
        expect(buildQueryObjectFromString(queryString, plan), `'${queryString}'`).toEqual(
          buildQueryObject(new URLSearchParams(queryString), plan),
        )
      }
    }
  })
})
