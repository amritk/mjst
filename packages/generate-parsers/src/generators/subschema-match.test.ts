import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

import { canMatchSubschema, subschemaMatchExpr } from './subschema-match'

/**
 * The matcher underpins the strict enforcement of `contains`, `propertyNames`,
 * and `dependentSchemas`: it must be sound in BOTH directions (its expression is
 * true exactly when the value matches) and must return `null` for any form it
 * cannot prove — that `null` is what makes the generation-time guard reject the
 * schema instead of emitting a permissive parser.
 */

/**
 * Compiles the matcher expression into a predicate over a value bound to `x`.
 * The expression carries TS `as` casts (it is emitted into generated TS), so
 * strip types with esbuild before evaluating — the same transform the parser
 * differential harness uses.
 */
const predicate = (schema: unknown): ((x: unknown) => boolean) => {
  const expr = subschemaMatchExpr('x', schema as never)
  if (expr === null) throw new Error('expected a matchable schema')
  const js = transformSync(`export const p = (x) => (${expr});`, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', js)(mod, mod.exports)
  return mod.exports['p'] as (x: unknown) => boolean
}

describe('subschemaMatchExpr — matchable forms', () => {
  it('matches scalar types with constraints exactly', () => {
    const p = predicate({ type: 'string', minLength: 2, maxLength: 4 })
    expect(p('ab')).toBe(true)
    expect(p('abcd')).toBe(true)
    expect(p('a')).toBe(false)
    expect(p('abcde')).toBe(false)
    expect(p(3)).toBe(false)
  })

  it('matches integer vs number', () => {
    expect(predicate({ type: 'integer' })(3)).toBe(true)
    expect(predicate({ type: 'integer' })(3.5)).toBe(false)
    expect(predicate({ type: 'number' })(3.5)).toBe(true)
  })

  it('matches const and enum', () => {
    expect(predicate({ const: 'x' })('x')).toBe(true)
    expect(predicate({ const: 'x' })('y')).toBe(false)
    const e = predicate({ enum: ['a', 2, null] })
    expect(e('a')).toBe(true)
    expect(e(2)).toBe(true)
    expect(e(null)).toBe(true)
    expect(e('b')).toBe(false)
  })

  it('matches arrays with item and length constraints', () => {
    const p = predicate({ type: 'array', items: { type: 'number' }, minItems: 1 })
    expect(p([1, 2])).toBe(true)
    expect(p([])).toBe(false)
    expect(p([1, 'x'])).toBe(false)
  })

  it('matches objects with nested properties and required', () => {
    const p = predicate({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] })
    expect(p({ a: 1 })).toBe(true)
    expect(p({ a: 1, extra: true })).toBe(true)
    expect(p({})).toBe(false)
    expect(p({ a: 'x' })).toBe(false)
  })

  it('applies type-less string constraints only to strings (JSON Schema semantics)', () => {
    // `{ maxLength: 3 }` constrains strings but is a no-op for other types.
    const p = predicate({ maxLength: 3 })
    expect(p('abc')).toBe(true)
    expect(p('abcd')).toBe(false)
    expect(p(123456)).toBe(true) // not a string → unconstrained
    expect(p({ any: 'thing' })).toBe(true)
  })

  it('applies type-less required only to objects', () => {
    const p = predicate({ required: ['b'] })
    expect(p({ b: 1 })).toBe(true)
    expect(p({})).toBe(false)
    expect(p('not an object')).toBe(true) // required is a no-op for non-objects
  })

  it('treats an empty / annotation-only schema as matching everything', () => {
    expect(subschemaMatchExpr('x', {} as never)).toBe('true')
    expect(subschemaMatchExpr('x', { title: 'ignored', description: 'x' } as never)).toBe('true')
    expect(subschemaMatchExpr('x', true as never)).toBe('true')
    expect(subschemaMatchExpr('x', false as never)).toBe('false')
  })
})

describe('subschemaMatchExpr — unprovable forms return null', () => {
  it.each([
    ['$ref', { $ref: '#/$defs/x' }],
    ['oneOf', { oneOf: [{ type: 'string' }, { type: 'number' }] }],
    ['anyOf', { anyOf: [{ pattern: '^a' }] }],
    ['not', { not: { type: 'string' } }],
    ['allOf', { allOf: [{ type: 'string' }] }],
    ['array-form type', { type: ['string', 'null'] }],
    ['structural const', { const: { a: 1 } }],
    ['schema additionalProperties', { type: 'object', additionalProperties: { type: 'string' } }],
    ['tuple items', { type: 'array', items: [{ type: 'string' }] }],
    ['unknown constraining keyword', { patternProperties: { '^a': { type: 'string' } } }],
  ])('%s', (_label, schema) => {
    expect(subschemaMatchExpr('x', schema as never)).toBeNull()
    expect(canMatchSubschema(schema as never)).toBe(false)
  })
})
