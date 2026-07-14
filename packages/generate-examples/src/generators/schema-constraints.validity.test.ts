import { validate } from '@amritk/runtime-validators'
import Ajv from 'ajv/dist/2020'
import * as fc from 'fast-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildExampleSchema } from './build-schema'
import { deriveExample } from './derive-example'
import { generateArbitrary } from './generate-arbitrary'

/**
 * The generators promise their output is a *valid instance* of the schema. These
 * cases exercise the constraint keywords that were previously ignored — the
 * presence-gated object keywords (`patternProperties`, `propertyNames`,
 * `dependentRequired`, `dependentSchemas`, `minProperties`, `maxProperties`),
 * `contains`, sibling-constrained `enum`s, and the applicators reconciled by a
 * validating filter (`if`/`then`/`else`, `not`, `oneOf` exclusivity).
 *
 * Both the static `deriveExample` value and samples from the generated arbitrary
 * are validated against the schema with Ajv — an independent oracle, so a pass is
 * not merely the generator agreeing with the validator it filters through.
 */
const cases: Array<{ name: string; schema: JSONSchema }> = [
  {
    name: 'patternProperties with additionalProperties:false and minProperties',
    schema: {
      type: 'object',
      properties: {},
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: false,
      minProperties: 1,
    },
  },
  {
    name: 'propertyNames pattern with minProperties on a dictionary',
    schema: {
      type: 'object',
      additionalProperties: { type: 'integer' },
      propertyNames: { pattern: '^[a-z]+$' },
      minProperties: 2,
    },
  },
  {
    name: 'dependentRequired',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['b'] },
    },
  },
  {
    name: 'dependentSchemas',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependentSchemas: { a: { required: ['c'], properties: { c: { type: 'integer' } } } },
    },
  },
  {
    name: 'maxProperties trims optional keys',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      required: ['a'],
      maxProperties: 2,
    },
  },
  {
    name: 'dictionary with minProperties and maxProperties',
    schema: { type: 'object', additionalProperties: { type: 'integer' }, minProperties: 2, maxProperties: 4 },
  },
  {
    name: 'contains',
    schema: { type: 'array', contains: { type: 'integer', minimum: 100 }, minItems: 1 },
  },
  {
    name: 'if/then/else adds a conditionally-required property',
    schema: {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] }, value: { type: 'integer' } },
      required: ['kind'],
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['value'] },
    },
  },
  {
    name: 'not excludes a forbidden value',
    schema: { type: 'string', not: { enum: ['forbidden'] } },
  },
  {
    name: 'oneOf with mutually-exclusive branches',
    schema: {
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
        { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'], additionalProperties: false },
      ],
    },
  },
  {
    name: 'nested oneOf inside a property',
    schema: {
      type: 'object',
      properties: { payload: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
      required: ['payload'],
    },
  },
  {
    name: 'enum filtered by a sibling minLength',
    schema: { type: 'string', enum: ['a', 'bbbb', 'cc'], minLength: 2 },
  },
]

const ajv = new Ajv({ strict: false, allErrors: false })

/**
 * Evaluates generated arbitrary source with `fast-check` and the runtime
 * validator in scope — mimicking the compiled module — and returns the arbitrary.
 */
const evalArbitrary = (schema: JSONSchema, typeName = 'Sample'): fc.Arbitrary<unknown> => {
  const code = generateArbitrary(schema, typeName)
  const js = code
    .replace(/fc\.letrec<[^>]*>/g, 'fc.letrec')
    .replace(new RegExp(`export const ${typeName}Arbitrary: fc\\.Arbitrary<[^>]*> = `), 'return ')
  return new Function('fc', '__mjstValidate', js)(fc, validate) as fc.Arbitrary<unknown>
}

describe('schema-constraint coverage — every generated value validates', () => {
  for (const { name, schema } of cases) {
    const check = ajv.compile(schema as object)

    it(`deriveExample is a valid instance: ${name}`, () => {
      const value = deriveExample(schema)
      expect(check(value), `${JSON.stringify(value)} — ${JSON.stringify(check.errors)}`).toBe(true)
    })

    it(`every arbitrary sample is a valid instance: ${name}`, () => {
      const arbitrary = evalArbitrary(schema)
      const samples = fc.sample(arbitrary, 30)
      for (const sample of samples) {
        expect(check(sample), `${JSON.stringify(sample)} — ${JSON.stringify(check.errors)}`).toBe(true)
      }
    })
  }
})

describe('generated file wiring for the validating filter', () => {
  const mainFile = async (schema: JSONSchema) => {
    const files = await buildExampleSchema(schema, 'Sample')
    const file = files.find((f) => f.filename !== 'index.ts')
    if (!file) throw new Error('no schema file generated')
    return file.content
  }

  it('imports the runtime validator only when a filter is emitted', async () => {
    const withFilter = await mainFile({ type: 'string', not: { const: 'x' } })
    expect(withFilter).toContain("import { validate as __mjstValidate } from '@amritk/runtime-validators'")
    expect(withFilter).toContain('.filter((value) =>')
  })

  it('omits the runtime-validators import for schemas no filter touches', async () => {
    const plain = await mainFile({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
    expect(plain).not.toContain('runtime-validators')
    expect(plain).not.toContain('.filter((value) =>')
  })
})
