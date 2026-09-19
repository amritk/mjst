import { transformSync } from 'esbuild'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { generateUniqueItemsCheck } from './generate-unique-items-check'

/**
 * Runs the emitted expression against a real array. It carries TypeScript casts,
 * so it is stripped with esbuild first — the same route the parser fuzzers take.
 */
const run = (schema: JSONSchema, value: readonly unknown[]): boolean => {
  const js = transformSync(
    `export const check = (x: readonly unknown[]) => (${generateUniqueItemsCheck('x', schema)})`,
    {
      loader: 'ts',
      format: 'cjs',
      target: 'es2022',
    },
  ).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', js)(mod, mod.exports)
  return (mod.exports['check'] as (x: readonly unknown[]) => boolean)(value)
}

describe('generate-unique-items-check', () => {
  it('keeps the cheap native Set when every item is provably scalar', () => {
    const schema = { type: 'array', items: { type: 'string' } } satisfies JSONSchema
    expect(generateUniqueItemsCheck('x', schema)).toBe('new Set(x).size === x.length')
    expect(run(schema, ['a', 'b'])).toBe(true)
    expect(run(schema, ['a', 'a'])).toBe(false)
  })

  it('treats an all-scalar tuple as scalar', () => {
    const schema = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false } as JSONSchema
    expect(generateUniqueItemsCheck('x', schema)).toBe('new Set(x).size === x.length')
  })

  it('falls back to a structural projection when the tail may be an object', () => {
    const schema = {
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'object' },
    } as JSONSchema
    expect(generateUniqueItemsCheck('x', schema)).toContain('Object.keys(_v).sort()')
  })

  it('detects a reordered-but-equal object duplicate', () => {
    const schema = { type: 'array', items: { type: 'object' } } satisfies JSONSchema
    // `JSON.stringify` alone keys these differently, so the duplicate used to
    // pass — while Ajv, the interpreter, and generate-validators all reject it.
    expect(run(schema, [{ a: 1, b: 2 }, JSON.parse('{"b":2,"a":1}')])).toBe(false)
    expect(
      run(schema, [
        { a: 1, b: 2 },
        { a: 1, b: 3 },
      ]),
    ).toBe(true)
  })

  it('canonicalizes nested objects too', () => {
    const schema = { type: 'array', items: { type: 'object' } } satisfies JSONSchema
    expect(run(schema, [{ a: 1, b: { c: 3, d: 4 } }, JSON.parse('{"b":{"d":4,"c":3},"a":1}')])).toBe(false)
  })

  it('treats an untyped array as possibly structural', () => {
    // No `items` means anything could be in there, so scalar-only is unprovable.
    expect(generateUniqueItemsCheck('x', { type: 'array' } satisfies JSONSchema)).toContain('Object.keys(_v).sort()')
  })

  it('keeps a key shadowing an Object.prototype member in the projection', () => {
    const schema = { type: 'array', items: { type: 'object' } } satisfies JSONSchema
    expect(run(schema, [JSON.parse('{"__proto__":1,"a":2}'), JSON.parse('{"a":2,"__proto__":1}')])).toBe(false)
    expect(run(schema, [JSON.parse('{"__proto__":1}'), JSON.parse('{"__proto__":2}')])).toBe(true)
  })
})
