import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

import { generateDeepEqualCheck } from './generate-deep-equal-check'

/**
 * The emitted expression is what actually has to be right, so most cases run it
 * rather than assert on its text. It carries TypeScript casts, so it goes through
 * esbuild first — the same strip-and-eval the parser fuzzers use.
 */
const run = (value: unknown, input: unknown): boolean => {
  const js = transformSync(`export const check = (x: unknown) => (${generateDeepEqualCheck('x', value)})`, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
  }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', js)(mod, mod.exports)
  return (mod.exports['check'] as (x: unknown) => boolean)(input)
}

describe('generate-deep-equal-check', () => {
  it('compares primitives with ===', () => {
    expect(generateDeepEqualCheck('x', 'a')).toBe('x === "a"')
    expect(generateDeepEqualCheck('x', 3)).toBe('x === 3')
    expect(generateDeepEqualCheck('x', null)).toBe('x === null')
    expect(generateDeepEqualCheck('x', true)).toBe('x === true')
  })

  it('uses Number.isNaN for a NaN literal, which === can never match', () => {
    expect(generateDeepEqualCheck('x', Number.NaN)).toBe('Number.isNaN(x)')
    expect(run(Number.NaN, Number.NaN)).toBe(true)
    expect(run(Number.NaN, 1)).toBe(false)
  })

  it('matches an object regardless of key order', () => {
    expect(run({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    expect(run({ a: 1, b: 2 }, JSON.parse('{"b":2,"a":1}'))).toBe(true)
  })

  it('rejects an object with an extra or missing key', () => {
    expect(run({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(run({ a: 1, b: 2 }, { a: 1, b: 2, c: 3 })).toBe(false)
    expect(run({}, {})).toBe(true)
    expect(run({}, { a: 1 })).toBe(false)
  })

  it('recurses through nested objects and arrays', () => {
    expect(run({ a: [1, { x: 1, y: 2 }] }, JSON.parse('{"a":[1,{"y":2,"x":1}]}'))).toBe(true)
    expect(run({ a: [1, { x: 1, y: 2 }] }, { a: [1, { x: 1, y: 3 }] })).toBe(false)
  })

  it('pins array length as well as element order', () => {
    expect(run(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(run(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(run(['a', 'b'], ['a'])).toBe(false)
    expect(run(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
    expect(run([], [])).toBe(true)
  })

  it('does not confuse an array with an object', () => {
    expect(run({ 0: 'a' }, ['a'])).toBe(false)
    expect(run(['a'], { 0: 'a' })).toBe(false)
    expect(run({ a: 1 }, null)).toBe(false)
  })

  it('reads a key that shadows an Object.prototype member as an own property', () => {
    // `{}.constructor` is a function, so a naive read would compare the
    // prototype's value instead of the document's — and never match.
    const literal = JSON.parse('{"constructor":"x"}')
    expect(run(literal, JSON.parse('{"constructor":"x"}'))).toBe(true)
    expect(run(literal, {})).toBe(false)
  })
})
