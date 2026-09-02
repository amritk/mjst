import { describe, expect, it } from 'vitest'

import { evaluateGenerated } from './evaluate-generated.test-utils'
import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

/**
 * Frozen objects are ordinary inputs — a config loaded once and frozen, a shared
 * test fixture, a module-level constant (the public
 * `moltar/typescript-runtime-type-benchmarks` fixture is itself an
 * `Object.freeze({ ... })`). They are also the one input shape where the
 * strict-mode fast path behaves *very* differently at runtime: the extra-key
 * sweep every `additionalProperties: false` validator needs
 * (`Object.keys` / `for...in`) drops to a generic slow path on JavaScriptCore
 * once an object is non-extensible. `bench/schemas.ts` carries the frozen
 * throughput cases; this file pins the part that must never move — the verdict.
 *
 * Freezing changes nothing a validator is allowed to observe, so every generated
 * entry point has to answer identically frozen and unfrozen, and has to leave
 * the document untouched either way.
 */
type Built = {
  validate: (input: unknown) => unknown
  guard: (input: unknown) => boolean
}

const build = (schema: unknown): Built => {
  // biome-ignore lint/suspicious/noExplicitAny: bench-shaped fixtures, typed as JSON Schema by construction
  const code = `${generateValidatorFunction(schema as any, 'Doc')}\n\n${generateBooleanGuard(schema as any, 'Doc')}`
  const exports = evaluateGenerated(code)
  return {
    validate: exports['validateDoc'] as (input: unknown) => unknown,
    guard: exports['isDoc'] as (input: unknown) => boolean,
  }
}

/** Freezes `value` and everything reachable from it, mirroring the bench pool. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/**
 * Asserts `validateDoc` and `isDoc` give the same answer on a document and on a
 * deep-frozen copy of it, and that neither one writes to the frozen copy.
 *
 * The generated code is evaluated through `new Function`, which runs sloppy —
 * a stray write to a frozen object would be silently dropped there rather than
 * throwing as it would in the emitted ES module. So the no-mutation half is
 * checked by comparing the document afterwards rather than by expecting a throw.
 */
const expectFrozenParity = (schema: unknown, document: unknown): void => {
  const { validate, guard } = build(schema)
  const frozen = deepFreeze(structuredClone(document))
  const before = JSON.stringify(frozen)

  const label = JSON.stringify(document)
  expect(validate(frozen), `validateDoc disagreed on frozen ${label}`).toEqual(validate(structuredClone(document)))
  expect(guard(frozen), `isDoc disagreed on frozen ${label}`).toBe(guard(structuredClone(document)))
  expect(JSON.stringify(frozen), `a validator wrote to frozen ${label}`).toBe(before)
}

/** The `moltar` assert-strict shape: all-required properties, closed at both levels. */
const strictSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'number' },
    string: { type: 'string' },
    deeplyNested: {
      type: 'object',
      additionalProperties: false,
      properties: { foo: { type: 'string' }, num: { type: 'number' } },
      required: ['foo', 'num'],
    },
  },
  required: ['number', 'string', 'deeplyNested'],
}

/** Closed, but with an optional property — the shape whose guard sweeps keys instead of counting them. */
const optionalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string' }, note: { type: 'string' } },
  required: ['id'],
}

const validStrict = { number: 1, string: 'string', deeplyNested: { foo: 'bar', num: 1 } }

describe('frozen-input', () => {
  it('accepts a frozen document that satisfies a closed object schema', () => {
    expectFrozenParity(strictSchema, validStrict)
  })

  it('rejects an undeclared key on a frozen document', () => {
    expectFrozenParity(strictSchema, { ...validStrict, extra: true })
  })

  it('rejects an undeclared nested key on a frozen document', () => {
    expectFrozenParity(strictSchema, { ...validStrict, deeplyNested: { foo: 'bar', num: 1, extra: true } })
  })

  it('reports the same errors for a frozen document with a wrong-typed property', () => {
    expectFrozenParity(strictSchema, { ...validStrict, number: 'not a number' })
  })

  it('reports a missing required property on a frozen document', () => {
    expectFrozenParity(strictSchema, { string: 'string', deeplyNested: { foo: 'bar', num: 1 } })
  })

  it('handles a frozen document against a closed schema with an optional property', () => {
    for (const document of [{ id: 'a' }, { id: 'a', note: 'n' }, { id: 'a', other: 1 }]) {
      expectFrozenParity(optionalSchema, document)
    }
  })

  it('handles frozen arrays of frozen objects', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { sku: { type: 'string' } },
        required: ['sku'],
      },
    }
    for (const document of [[{ sku: 'a' }, { sku: 'b' }], [{ sku: 'a', extra: 1 }], []]) {
      expectFrozenParity(schema, document)
    }
  })
})
