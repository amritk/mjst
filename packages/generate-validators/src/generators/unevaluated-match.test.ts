import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { type UnevaluatedMatchFn, unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

/**
 * Verdict parity with the interpreter is proved in `interpreter-parity.test.ts`,
 * where it belongs — running both implementations against one oracle says more
 * about correctness than any expectation written here could. What this file pins
 * is the module's *contract*, which that suite cannot see: the three-way return
 * (`undefined` = nothing to check, `null` = refuse, an expression = check this),
 * and the shape of what comes back.
 */

/** Stands in for the validator's real matcher; the expressions only have to be recognisable. */
const match: UnevaluatedMatchFn = (accessor, schema) => `matches(${accessor}, ${JSON.stringify(schema)})`

const properties = (schema: JSONSchema, rootSchema?: Record<string, unknown>) =>
  unevaluatedPropertiesExpr('value', schema, rootSchema, 0, match)

const items = (schema: JSONSchema, rootSchema?: Record<string, unknown>) =>
  unevaluatedItemsExpr('value', schema, rootSchema, 0, match)

describe('unevaluated-match', () => {
  it('has nothing to check when the keyword is absent or permits everything', () => {
    expect(properties({ properties: { a: true } })).toBeUndefined()
    expect(properties({ properties: { a: true }, unevaluatedProperties: true })).toBeUndefined()
    expect(items({ prefixItems: [true] })).toBeUndefined()
    expect(items({ prefixItems: [true], unevaluatedItems: true })).toBeUndefined()
  })

  it('has nothing to check when the other keywords already sweep the value', () => {
    // `additionalProperties` is the fallback for every key nothing else claims,
    // so it leaves no leftovers for an unevaluated keyword to police.
    expect(properties({ additionalProperties: true, unevaluatedProperties: false })).toBeUndefined()
    expect(properties({ additionalProperties: { type: 'number' }, unevaluatedProperties: false })).toBeUndefined()
    // A tail `items` does the same for every index past the tuple.
    expect(items({ items: { type: 'string' }, unevaluatedItems: false })).toBeUndefined()
    expect(items({ prefixItems: [true], items: true, unevaluatedItems: false })).toBeUndefined()
  })

  it('demands an empty value when nothing at all is evaluated', () => {
    expect(properties({ unevaluatedProperties: false })?.expr).toBe(
      'Object.keys((value as Record<string, unknown>)).length === 0',
    )
    expect(items({ unevaluatedItems: false })?.expr).toBe('(value as unknown[]).length === 0')
  })

  it('builds the coverage terms from the adjacent keywords', () => {
    expect(properties({ properties: { a: true, b: true }, unevaluatedProperties: false })?.expr).toBe(
      'Object.keys((value as Record<string, unknown>)).every((_uk0) => ["a","b"].includes(_uk0))',
    )
    expect(properties({ patternProperties: { '^x-': true }, unevaluatedProperties: false })?.expr).toContain(
      '/^x-/.test(_uk0)',
    )
    expect(items({ prefixItems: [true, true], unevaluatedItems: false })?.expr).toContain('_un0 < 2')
  })

  it('makes a `contains` term look at the element, not the position', () => {
    // The interpreter publishes exactly the indices `contains` matched, so the
    // term has to ask whether *this* element matched — the one place the
    // generated form deliberately parts company with Ajv, which marks the lot.
    const expression = items({ contains: { type: 'string' }, unevaluatedItems: false })
    expect(expression?.expr).toContain('matches(_ue0, {"type":"string"})')
  })

  it('binds a branch condition to a local instead of re-running it per key', () => {
    const expression = properties({
      anyOf: [{ properties: { a: true } }],
      unevaluatedProperties: false,
    })
    expect(expression?.setup).toEqual(['const _uc0_0 = matches(value, {"properties":{"a":true}})'])
    expect(expression?.expr).toContain('(_uc0_0 && ["a"].includes(_uk0))')
  })

  it('validates the leftovers against a schema-form unevaluated keyword', () => {
    const expression = properties({ properties: { a: true }, unevaluatedProperties: { type: 'string' } })
    expect(expression?.expr).toBe(
      'Object.keys((value as Record<string, unknown>)).every((_uk0) => ["a"].includes(_uk0) || ' +
        'matches((value as Record<string, unknown>)[_uk0], {"type":"string"}))',
    )
  })

  it('reads coverage through a resolvable $ref', () => {
    const root = { $defs: { bar: { properties: { b: true } } } }
    const schema = { $ref: '#/$defs/bar', properties: { a: true }, unevaluatedProperties: false } as JSONSchema
    expect(properties(schema, root)?.expr).toContain('(["a"].includes(_uk0) || ["b"].includes(_uk0))')
  })

  it('refuses when the coverage walk cannot see the target', () => {
    // No document to resolve against, a target that is not there, a ref that
    // comes back to itself, and a ref only bound at validation time. Each leaves
    // the coverage unknown, and a guess would accept what the interpreter rejects.
    const schema = { $ref: '#/$defs/bar', unevaluatedProperties: false } as JSONSchema
    expect(properties(schema)).toBeNull()
    expect(properties(schema, { $defs: {} })).toBeNull()
    expect(properties({ $ref: '#', unevaluatedProperties: false } as JSONSchema, { $ref: '#' })).toBeNull()
    expect(properties({ $dynamicRef: '#node', unevaluatedProperties: false } as JSONSchema, {})).toBeNull()
    expect(items({ $dynamicRef: '#node', unevaluatedItems: false } as JSONSchema, {})).toBeNull()
  })
})
