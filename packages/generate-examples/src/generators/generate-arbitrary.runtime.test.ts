import { validate } from '@amritk/runtime-validators'
import * as fc from 'fast-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { generateArbitrary } from './generate-arbitrary'

/**
 * Evaluates a generated arbitrary with `fast-check` and the real runtime
 * validator in scope, mimicking the compiled module. The replacements strip
 * type-level syntax that erases at runtime; `new Function` parses plain JS.
 */
const evalArb = (schema: JSONSchema): fc.Arbitrary<unknown> => {
  const js = generateArbitrary(schema, 'S')
    .replace(/fc\.letrec<[^>]*>/g, 'fc.letrec')
    .replaceAll(' as const', '')
    .replaceAll(' as fc.Arbitrary<unknown>', '')
    .replace(/\(value\): value is [^=]+=>/g, '(value) =>')
    .replace(/export const SArbitrary: fc\.Arbitrary<[^>]*> = /, 'return ')
  return new Function('fc', '__mjstValidate', js)(fc, validate) as fc.Arbitrary<unknown>
}

/**
 * Schemas whose generated arbitrary used to throw on import, or retry forever
 * when sampled. A `.toContain` assertion cannot see either failure — only
 * actually evaluating the emitted module and drawing values from it can — and
 * both leave the generated file useless to a consumer despite compiling cleanly.
 */
const cases: Array<[string, JSONSchema]> = [
  ['uncompilable pattern', { type: 'string', pattern: '[' }],
  ['lookahead pattern', { type: 'string', pattern: '^(?=.*a)b+$' }],
  ['lookbehind pattern', { type: 'string', pattern: '^(?<=a)b$' }],
  ['bad patternProperties key', { type: 'object', patternProperties: { '[': { type: 'string' } } }],
  ['huge integer minimum', { type: 'integer', minimum: 1e30 }],
  ['huge integer maximum', { type: 'integer', maximum: -1e30 }],
  ['uniqueItems over booleans', { type: 'array', items: { type: 'boolean' }, minItems: 5, uniqueItems: true }],
  ['uniqueItems over a 2-enum', { type: 'array', items: { enum: ['a', 'b'] }, minItems: 4, uniqueItems: true }],
  ['large integer multipleOf', { type: 'integer', multipleOf: 1_000_000 }],
] as Array<[string, JSONSchema]>

describe('generated arbitraries load and sample', () => {
  for (const [name, schema] of cases) {
    it(`samples without throwing or hanging: ${name}`, () => {
      // Evaluating is half the test: an uncompilable `pattern` or an embedded
      // validator that refuses to build throws here, at "import".
      const arb = evalArb(schema)
      expect(() => fc.sample(arb, 5)).not.toThrow()
    }, 15_000)
  }
})
