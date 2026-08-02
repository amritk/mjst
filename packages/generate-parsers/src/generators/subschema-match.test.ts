import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

import { canMatchSubschema, subschemaMatchExpr } from './subschema-match'

/**
 * The matcher underpins the strict enforcement of `contains`, `propertyNames`,
 * `dependentSchemas`, `unevaluated*` and the whole-schema backstop: it must be
 * sound in BOTH directions (its expression is true exactly when the value
 * matches) and must return `null` for any form it cannot prove — that `null` is
 * what makes the generation-time guard reject the schema instead of emitting a
 * permissive parser.
 */

/**
 * Compiles the matcher expression into a predicate over a value bound to `x`.
 * The expression carries TS `as` casts (it is emitted into generated TS), so
 * strip types with esbuild before evaluating — the same transform the parser
 * differential harness uses.
 */
const predicate = (schema: unknown, rootSchema?: unknown): ((x: unknown) => boolean) => {
  const expr = subschemaMatchExpr('x', schema as never, rootSchema ? { rootSchema: rootSchema as never } : {})
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

  it('counts string length in code points, not UTF-16 units', () => {
    // `"💩".length` is 2 but it is a single code point, which is what JSON
    // Schema (and Ajv, the oracle) measures.
    const min = predicate({ type: 'string', minLength: 2 })
    expect(min('💩')).toBe(false)
    expect(min('💩💩')).toBe(true)
    const max = predicate({ type: 'string', maxLength: 2 })
    expect(max('💩💩')).toBe(true)
    expect(max('💩💩💩')).toBe(false)
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

  it('compares a structural const by value, not by reference', () => {
    const p = predicate({ const: { a: 1, b: [2] } })
    expect(p({ a: 1, b: [2] })).toBe(true)
    expect(p({ b: [2], a: 1 })).toBe(true)
    expect(p({ a: 1 })).toBe(false)
    expect(p({ a: 1, b: [3] })).toBe(false)
  })

  it('treats an empty enum as matching nothing', () => {
    expect(subschemaMatchExpr('x', { enum: [] } as never)).toBe('false')
  })

  it('matches arrays with item and length constraints', () => {
    const p = predicate({ type: 'array', items: { type: 'number' }, minItems: 1 })
    expect(p([1, 2])).toBe(true)
    expect(p([])).toBe(false)
    expect(p([1, 'x'])).toBe(false)
  })

  it('matches tuple positions, the items tail, and items: false', () => {
    const tuple = predicate({ type: 'array', prefixItems: [{ type: 'number' }, { type: 'string' }] })
    expect(tuple([])).toBe(true)
    expect(tuple([1])).toBe(true)
    expect(tuple([1, 'a'])).toBe(true)
    expect(tuple([1, 2])).toBe(false)
    expect(tuple(['a'])).toBe(false)

    const capped = predicate({ type: 'array', prefixItems: [{ type: 'number' }], items: false })
    expect(capped([1])).toBe(true)
    expect(capped([1, 2])).toBe(false)

    const tail = predicate({ type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'string' } })
    expect(tail([1, 'a', 'b'])).toBe(true)
    expect(tail([1, 2])).toBe(false)

    // Draft-07 spells the tuple as an array-valued `items` with the tail in
    // `additionalItems`; both forms have to reach the same checks.
    const legacy = predicate({ type: 'array', items: [{ type: 'number' }], additionalItems: false })
    expect(legacy([1])).toBe(true)
    expect(legacy([1, 2])).toBe(false)

    expect(predicate({ type: 'array', items: false })([])).toBe(true)
    expect(predicate({ type: 'array', items: false })([1])).toBe(false)
  })

  it('matches contains with its minContains / maxContains bounds', () => {
    const p = predicate({ type: 'array', contains: { type: 'number' } })
    expect(p([1])).toBe(true)
    expect(p(['a', 1])).toBe(true)
    expect(p([])).toBe(false)
    expect(p(['a'])).toBe(false)

    const bounded = predicate({ type: 'array', contains: { const: 1 }, minContains: 2, maxContains: 3 })
    expect(bounded([1])).toBe(false)
    expect(bounded([1, 1])).toBe(true)
    expect(bounded([1, 1, 1, 1])).toBe(false)

    // `minContains: 0` with no upper bound constrains nothing.
    expect(predicate({ type: 'array', contains: { const: 1 }, minContains: 0 })([])).toBe(true)
  })

  it('matches objects with nested properties and required', () => {
    const p = predicate({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] })
    expect(p({ a: 1 })).toBe(true)
    expect(p({ a: 1, extra: true })).toBe(true)
    expect(p({})).toBe(false)
    expect(p({ a: 'x' })).toBe(false)
  })

  it('matches patternProperties, a schema additionalProperties, and their interaction', () => {
    const patterns = predicate({ type: 'object', patternProperties: { '^s_': { type: 'string' } } })
    expect(patterns({ s_a: 'x' })).toBe(true)
    expect(patterns({ s_a: 1 })).toBe(false)
    expect(patterns({ other: 1 })).toBe(true)

    const additional = predicate({ type: 'object', properties: { a: {} }, additionalProperties: { type: 'number' } })
    expect(additional({ a: 'anything' })).toBe(true)
    expect(additional({ b: 1 })).toBe(true)
    expect(additional({ b: 'x' })).toBe(false)

    // `additionalProperties: false` must not police keys `patternProperties` owns.
    const closed = predicate({
      type: 'object',
      properties: { a: { type: 'number' } },
      patternProperties: { '^s_': { type: 'string' } },
      additionalProperties: false,
    })
    expect(closed({ a: 1, s_b: 'y' })).toBe(true)
    expect(closed({ zz: 1 })).toBe(false)
  })

  it('matches propertyNames, dependentRequired and dependentSchemas', () => {
    const names = predicate({ type: 'object', propertyNames: { maxLength: 3 } })
    expect(names({ ab: 1 })).toBe(true)
    expect(names({ abcd: 1 })).toBe(false)

    const dependentRequired = predicate({ type: 'object', dependentRequired: { a: ['b'] } })
    expect(dependentRequired({})).toBe(true)
    expect(dependentRequired({ a: 1 })).toBe(false)
    expect(dependentRequired({ a: 1, b: 2 })).toBe(true)

    const dependentSchemas = predicate({ type: 'object', dependentSchemas: { a: { required: ['b'] } } })
    expect(dependentSchemas({})).toBe(true)
    expect(dependentSchemas({ a: 1 })).toBe(false)
    expect(dependentSchemas({ a: 1, b: 2 })).toBe(true)
  })

  it('proves an array-form type as a disjunction, each branch keeping its own constraints', () => {
    const p = predicate({ type: ['string', 'number'], minLength: 2, minimum: 5 })
    expect(p('ab')).toBe(true)
    expect(p('a')).toBe(false)
    expect(p(6)).toBe(true)
    expect(p(4)).toBe(false)
    expect(p(null)).toBe(false)

    const nullable = predicate({ type: ['object', 'null'], properties: { z: { type: 'string' } }, required: ['z'] })
    expect(nullable(null)).toBe(true)
    expect(nullable({ z: 'x' })).toBe(true)
    expect(nullable({})).toBe(false)
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

describe('subschemaMatchExpr — $ref', () => {
  const root = {
    $defs: {
      shortName: { type: 'string', maxLength: 3 },
      anchored: { $anchor: 'num', type: 'number' },
      needsB: { required: ['b'] },
    },
  }

  it('resolves a pointer ref against the root document', () => {
    const p = predicate({ $ref: '#/$defs/shortName' }, root)
    expect(p('ab')).toBe(true)
    expect(p('abcd')).toBe(false)
    expect(p(1)).toBe(false)
  })

  it('resolves an $anchor ref', () => {
    const p = predicate({ $ref: '#num' }, root)
    expect(p(1)).toBe(true)
    expect(p('x')).toBe(false)
  })

  it('keeps a 2020-12 $ref sibling keyword in force', () => {
    // Draft-07 ignored a `$ref`'s siblings; 2020-12 applies both.
    const p = predicate({ $ref: '#/$defs/needsB', minProperties: 2 }, root)
    expect(p({ b: 1, c: 2 })).toBe(true)
    expect(p({ b: 1 })).toBe(false)
    expect(p({ c: 1, d: 2 })).toBe(false)
  })

  it('bails without a root document, on an unresolvable target, and on a cycle', () => {
    expect(subschemaMatchExpr('x', { $ref: '#/$defs/shortName' } as never)).toBeNull()
    expect(subschemaMatchExpr('x', { $ref: '#/$defs/nope' } as never, { rootSchema: root })).toBeNull()
    const cyclic = { $defs: { node: { properties: { next: { $ref: '#/$defs/node' } } } } }
    expect(subschemaMatchExpr('x', { $ref: '#/$defs/node' } as never, { rootSchema: cyclic })).toBeNull()
  })
})

describe('subschemaMatchExpr — unevaluated keywords', () => {
  it('rejects properties no other keyword evaluated', () => {
    const p = predicate({ type: 'object', properties: { a: {} }, unevaluatedProperties: false })
    expect(p({})).toBe(true)
    expect(p({ a: 1 })).toBe(true)
    expect(p({ b: 1 })).toBe(false)
  })

  it('counts properties evaluated by allOf and $ref', () => {
    const p = predicate({ allOf: [{ properties: { a: {} } }], properties: { b: {} }, unevaluatedProperties: false })
    expect(p({ a: 1, b: 2 })).toBe(true)
    expect(p({ c: 1 })).toBe(false)

    const root = { $defs: { withA: { properties: { a: {} } } } }
    const viaRef = predicate({ $ref: '#/$defs/withA', unevaluatedProperties: false }, root)
    expect(viaRef({ a: 1 })).toBe(true)
    expect(viaRef({ b: 1 })).toBe(false)
  })

  it('counts a branch only when the branch matches', () => {
    const p = predicate({
      anyOf: [
        { properties: { a: { type: 'number' } }, required: ['a'] },
        { properties: { b: { type: 'number' } }, required: ['b'] },
      ],
      unevaluatedProperties: false,
    })
    expect(p({ a: 1 })).toBe(true)
    expect(p({ b: 1 })).toBe(true)
    // `a` is evaluated only by the branch that requires it — and that branch
    // fails here, so `a` is left unevaluated.
    expect(p({ b: 1, a: 'not a number' })).toBe(false)
  })

  it('follows if / then / else', () => {
    const p = predicate({
      if: { required: ['a'] },
      then: { properties: { b: {} } },
      properties: { a: {} },
      unevaluatedProperties: false,
    })
    expect(p({ a: 1, b: 2 })).toBe(true)
    expect(p({ b: 2 })).toBe(false)
  })

  it('validates leftovers against a schema-form unevaluatedProperties', () => {
    const p = predicate({ type: 'object', properties: { a: {} }, unevaluatedProperties: { type: 'number' } })
    expect(p({ a: 'anything' })).toBe(true)
    expect(p({ b: 1 })).toBe(true)
    expect(p({ b: 'x' })).toBe(false)
  })

  it('is vacuous when another keyword already sweeps every key', () => {
    // `additionalProperties` is the fallback for every unclaimed key, so nothing
    // is ever left unevaluated.
    expect(
      subschemaMatchExpr('x', {
        type: 'object',
        properties: { a: {} },
        additionalProperties: true,
        unevaluatedProperties: false,
      } as never),
    ).toBe('typeof x === "object" && x !== null && !Array.isArray(x)')
  })

  it('rejects items no other keyword evaluated', () => {
    const p = predicate({ type: 'array', prefixItems: [{ type: 'number' }], unevaluatedItems: false })
    expect(p([])).toBe(true)
    expect(p([1])).toBe(true)
    expect(p([1, 2])).toBe(false)

    const schemaForm = predicate({
      type: 'array',
      prefixItems: [{ type: 'number' }],
      unevaluatedItems: { type: 'string' },
    })
    expect(schemaForm([1, 'a'])).toBe(true)
    expect(schemaForm([1, 2])).toBe(false)
  })

  // 2020-12 says `contains` evaluates only the items that match it, so a
  // leftover item is still the `unevaluatedItems` keyword's business. Ajv marks
  // the whole array evaluated instead, which is why the fuzz corpus excludes
  // this pairing (see parser-vocabulary-conformance.differential.test.ts).
  it('treats contains as evaluating only the items it matches', () => {
    const p = predicate({ type: 'array', contains: { type: 'number' }, unevaluatedItems: false })
    expect(p([1])).toBe(true)
    expect(p([1, 'a'])).toBe(false)
    expect(p(['a'])).toBe(false)
  })

  it('lets unevaluatedItems police what contains did not match', () => {
    const p = predicate({ type: 'array', contains: { type: 'number' }, unevaluatedItems: { type: 'string' } })
    expect(p([1, 'a'])).toBe(true)
    expect(p([1, true])).toBe(false)
  })

  // `minContains: 0` makes `contains` vacuously satisfied, but it still
  // annotates every item it happens to match.
  it('keeps annotating matched items when minContains is 0', () => {
    const p = predicate({ type: 'array', contains: { type: 'string' }, minContains: 0, unevaluatedItems: false })
    expect(p([])).toBe(true)
    expect(p(['foo', 'bar'])).toBe(true)
    expect(p(['foo', 0])).toBe(false)
  })

  // A `contains` that admits anything leaves nothing for `unevaluatedItems`.
  it('treats an always-matching contains as evaluating the whole array', () => {
    const p = predicate({ type: 'array', contains: true, unevaluatedItems: false })
    expect(p([1, 'a', null])).toBe(true)
  })
})

describe('subschemaMatchExpr — combinators', () => {
  it('proves allOf as a conjunction, anyOf as a disjunction, oneOf as an exact count', () => {
    expect(subschemaMatchExpr('x', { allOf: [{ type: 'string' }] } as never)).toBe('typeof x === "string"')
    expect(subschemaMatchExpr('x', { anyOf: [{ type: 'string' }, { type: 'number' }] } as never)).toBe(
      '(typeof x === "string" || typeof x === "number")',
    )
    expect(subschemaMatchExpr('x', { oneOf: [{ type: 'string' }, { type: 'number' }] } as never)).toBe(
      '(((typeof x === "string" ? 1 : 0) + (typeof x === "number" ? 1 : 0)) === 1)',
    )
    expect(subschemaMatchExpr('x', { not: { type: 'string' } } as never)).toBe('!(typeof x === "string")')
  })

  it('still bails when a member is beyond the matcher', () => {
    expect(subschemaMatchExpr('x', { anyOf: [{ $ref: '#/$defs/x' }] } as never)).toBeNull()
    expect(subschemaMatchExpr('x', { not: { $ref: '#/$defs/x' } } as never)).toBeNull()
  })

  it('bounds recursion so a deeply nested combinator cannot blow up the output', () => {
    let schema: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 12; i++) schema = { allOf: [schema] }
    expect(subschemaMatchExpr('x', schema as never)).toBeNull()
  })
})

describe('subschemaMatchExpr — unprovable forms return null', () => {
  it.each([
    ['unknown constraining keyword', { someFutureKeyword: 3 }],
    ['$ref with no root document', { $ref: '#/$defs/x' }],
    ['unprovable contains subschema', { type: 'array', contains: { $ref: '#/$defs/x' } }],
    ['unprovable property subschema', { type: 'object', properties: { a: { $ref: '#/$defs/x' } } }],
  ])('%s', (_label, schema) => {
    expect(subschemaMatchExpr('x', schema as never)).toBeNull()
    expect(canMatchSubschema(schema as never)).toBe(false)
  })
})
